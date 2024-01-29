import { AnalysisNode, FilteredFeed, WrapFilter } from "../reasoning_prompts.js";
import fetch from 'node-fetch';
import * as math from 'mathjs';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expandChunk, getSimilarEmbeddings } from "../../external_hooks/pg_accesss.js";
import { getETA, getEmbeddings } from "../../external_hooks/replicate_embeddings.js";
import { asyncInputTextGenfeedback } from "../../dummy_text.js";
import { PromptNode } from "../reasoning_prompts.js";
import { MessageHistories } from "../../chat_history.js";
import { QueuedPool } from "../../queuedPool.js";

const prmpt_curator = new PromptNode("\
You are a search assistant AI that helps education-researcher AIs find relevant articles for teacher questions. In the <meta-excerpt> tags below is an excerpt from a chatlog between a user and a helpful education-researcher AI.\
<meta-excerpt>${chatlog}</meta-excerpt>\
\
The researcher has performed a search to find documents that might help them aid the user.\
In the <meta-searchresult> tags below is a search result returned by the server in response to that search.\
<meta-searchresult result_id=\"${article_id}\" page_start=\"${page_number_start}\" page_end=\"${page_number_end}\" publication_year=\"${publicationdateyear}\" publication_month=\"${publicationdatemonth}\" publisher=\"${publisher}\" publication_location=\"${identifiersgeo}\" peer_review=\"${peerreviewed}\" reference_count=\"${referencecount}\">\n\n${text_content}\n\n</meta-searchresult>\
\
Your task is to read through this result, and carefully consider whether it is relevant to answering the user's questions. The tag attributes contain metadata information about the result which you may consider when making your determination, if relevant.\
After reasoning aloud, please indicate your decision within <meta-decision> tags.\
\
The available decisions are:\
##KEEP-3## : The result directly and unambiguously answers the question the researcher is asking, and should be presented to the researcher.\
##KEEP-2## : The result does not provide a definitive answer, but does contain highly relevant information the researcher will likely wish to be aware of.\
##KEEP-1##: The result may be useful in conjunction with other results, though the information it offers seems somewhat tangential or otherwise insufficient to be of use on its own.\
##EXPAND## : The result looks promising, but its helpfulness appears limited due to truncation.\
##DISCARD## : This result isn't very helpful, or is otherwise just a disembodied list of references and should not be presented to the researcher. If the result is a reference which seems like it may be useful, the INVESTIGATE tag is probably more appropriate.\
##INVESTIGATE## : This result isn't super helpful on its own, but does reference another document or section worth searching for.\
\
It is critically important that you never select any level of 'KEEP' on a result if it is just a list of references. The only valid choices for lists of references are '##DISCARD##' and '##INVESTIGATE##'.\
\
Your final decision should be placed inside of <meta-decision> tags. For example, if you believe the result might potentially be useful, your response would end with <meta-decision>##KEEP-1##</meta-decision>\
");

function augment(output, withobj) {
    output.result.for_keeping = [...output.result.for_keeping, ...withobj.result.for_keeping];
    output.result.for_followup = [...output.result.for_followup, ...withobj.result.for_followup];
    output.result.for_discarding = [...output.result.for_discarding, ...withobj.result.for_discarding];
    return output;
}

const loopEval = async (run_node, s, in_packets, into_node) => {
    let outObj = await run_node.run(s.convo_branch, s.assistant, in_packets, into_node);
    let output = {
        current_thought_node: outObj.current_thought_node,
        thought_text: outObj.thought_text,
        result: {
            for_keeping : [],
            for_expansion :  [],
            for_discarding :  [],
            for_followup :  []
        }
    }
    function thisAug(withobj) {        
       output = augment(output, withobj)
    }
    if(outObj.result.for_keeping.length > 0) {
        thisAug(outObj);
    } else if (outObj.result.for_expansion.length > 0) {
        let expandedChunks = []
        for(let toexpand of outObj.result.for_expansion) {
            let expanded = await expandChunk(toexpand);
            expandedChunks.push(expanded);
        }
        in_packets.results = expandedChunks;
        into_node.setContent("", true);
        let loopres = await loopEval(run_node, s, in_packets, into_node);
        thisAug(loopres);
    }
    return output;
}

const CONCURRENT_MAX = 3;
export const aggregate_result_usefulness = new AnalysisNode(async (s = {
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    into_node: null,
    in_packets : null,
    me : this
}) => {
    let activeThoughts = Object.keys(s.assistant.replyingInto.thoughts).length
    let intoNode = s.into_node;
    if(activeThoughts > 0 && intoNode == null) {
        intoNode = s.assistant.replyingInto.thoughts[''+(activeThoughts-1)]            
    } else if (activeThoughts == 0 && intoNode == null) {
        intoNode = convo_branch[convo_branch.length-1].newThought('assistant', true);          
    }
    let qpool = new QueuedPool(CONCURRENT_MAX);
    for(let result of s.in_packets.ranked_results) {
        let subthought = intoNode.newThought('assistant', true);
        let runner = loopEval(evaluate_single_result_usefulness, s, {results: [result]}, subthought);
        qpool.run(runner)
    }    
    let all_results = await qpool.finish();
    let to_keep = []
    for(let outObj of all_results) {
        to_keep = [...to_keep, ...outObj.result.for_keeping]
        s.assistant.setAmGenerating(false, outObj.current_thought_node);
        s.assistant.setAmAnalyzing(false, outObj.current_thought_node);
        outObj.current_thought_node.setState('committed');
        outObj.current_thought_node.setState('hidden');
    }
    return {
        pruned_results : to_keep 
    }
});


const decision_tags = new WrapFilter('decide', ['<meta-decision>', '<decision>', '<META-DECISION>', '<DECISION>',], ['</meta-decision>', '</decision>', '</META-DECISION>', '</DECISION>'], true)
const decider_feed = new FilteredFeed([decision_tags]);

export const evaluate_single_result_usefulness = new AnalysisNode(async (s = {
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    into_node: null,
    in_packets : null,
    me : this
}) => {
    let candidate = s.in_packets.results[0];
    let inlinequoteform = s.prompt_coordinator.formatterFor('inliner');
    let chatform = s.prompt_coordinator.formatterFor('justrun');   
    
    let excerpt_text = inlinequoteform.stringCompletionFormat(s.convo_branch, null, false);
    let system_msg = prmpt_curator.getContent({chatlog: excerpt_text, ...candidate})
    let client = s.prompt_coordinator.clientHandlerFor('searcher');
    let model_name = s.prompt_coordinator.modelFor('searcher');
    const dummy_system = new MessageHistories('system', system_msg);
    const dummy_asst = new MessageHistories('assistant', 'After ');

    let convoRoles = [
        dummy_system,
        dummy_asst
    ]

    let chat_formatted = chatform.stringCompletionFormat(convoRoles, null, false);
    const expansion_limit = 2;

    const stream = await client.completions.create({//clientHandler({
        model: model_name,
        prompt: chat_formatted,
        temperature: 0.01,
        min_p: 0.2,
        stream: true,
        max_tokens: 1500
    });

    let feeder = decider_feed.clone()
    let feed = feeder.feed(stream);
    let keepScore = 0;
    let expandScore = 0;
    let discardScore = 0; 
    let investigateScore = -1;
    s.into_node.setContent("<section>"+candidate.text_content+"</section>\n\n", true);
    let thoughProcess = '';
    for await(const typedChunk of feed) {
        thoughProcess += typedChunk.text;
        s.into_node.appendContent(typedChunk.text, true);
        if(typedChunk.justExitedTag == 'decide') {
            candidate.decisionString = typedChunk.text;
            if(typedChunk.text.toUpperCase().indexOf("KEEP") > -1) {
                let addkeep = 0;
                if(typedChunk.text.toUpperCase().indexOf("KEEP-1") > -1) {
                    keepScore =1;
                }
                else if(typedChunk.text.toUpperCase().indexOf("KEEP-2") > -1) {
                    keepScore =2;
                }
                else if(typedChunk.text.toUpperCase().indexOf("KEEP-3") > -1) {
                    keepScore =3;
                }
                break;
            }
            if(typedChunk.text.toUpperCase().indexOf("DISCARD") > -1) {
                discardScore++; 
                break;
            }

            if(typedChunk.text.toUpperCase().indexOf('EXPAND') > -1) {
                if(candidate.granularity == 'desc' || candidate.expansion_count != null && candidate.expansion_count > expansion_limit)
                    keepScore++;
                else 
                    expandScore++;
                break;
            }
            if(typedChunk.text.toUpperCase().indexOf('INVESTIGATE') > -1) {
                investigateScore++;
                break;
            }
        }
    }
    candidate.keepScore = keepScore;
    return {
        current_thought_node: s.into_node,
        thought_text: candidate.text_content,
        on_complete: {commit : ""},
        result: {
            for_keeping : keepScore > 0 ? [candidate] : [],
            for_expansion : expandScore > 0 ? [candidate] : [],
            for_discarding : discardScore > 0 ? [candidate] : [],
            for_followup : investigateScore > 0 ? [candidate] : []
        }
    }
});