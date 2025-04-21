import { parse } from "uuid";
import { MessageHistories, ThoughtHistories } from "../../chat_history.js";
import { Formatter } from "../../formattings/Formatter.js";
import { known_formats } from "../../formattings/known_formats.js";
import { WrapFilter, AnalysisNode, PromptNode, PromptCoordinator, FilteredFeed } from "../reasoning_prompts.js";
import { ASST } from '../saigent.js';
import {OpenAI} from "openai";
import e from "express";
import { pre_ranker, retriever, testresult } from "../search_specialist/pre_ranker.js";
import { Converse, justrun, searchtags, createClientGen } from "./basic.js";
import { searcher, aggregated_search } from "../search_specialist/search_specialist.js";
import { aggregate_result_usefulness, evaluate_single_result_usefulness } from "../search_specialist/curator.js";
import { to, typed } from "mathjs";
import { CLIPFeatureExtractor } from "@xenova/transformers";
import { getETA } from "../../external_hooks/replicate_embeddings.js";

export const model_required = "gaunernst/gemma-3-27b-it-int4-awq";//'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-AWQ';



const MAX_RESULTS_CONSIDERED = 5;
export function ponderPromptInst(newAsst, endpoints_available) {
    //TODO: more robustly handle checks for model serving endpoints
    let model_url = endpoints_available[model_required][0];
    let basic_gen = createClientGen(model_url);
    
    let basic = new PromptCoordinator(newAsst);
    basic.addPromptNodes({
        'system' : Converse,//prmptconsider_action, 
        'determine': prmptconsider_action
    });
    
    //ponderer.task_hint = 'ponderer';
    let metatags = new WrapFilter('all_meta', ['<meta-decision>', '<meta>', '<meta-answer>'], ['</meta-decision>', '</meta>', '</meta-answer>'], true);
    let metaTagFeed = new FilteredFeed(metatags);
    let searchOrConverse = new FilteredFeed(
            new WrapFilter('search', ['##SEA'],['RCH##']), 
            new WrapFilter('converse', ['##CONV'] , ['ERSE##']));
    

    basic.setTaskHintClientHandler('ponderer', basic_gen);
    basic.setTaskHintFormatter('ponderer', new Formatter(null, known_formats[model_required]));
    basic.setTaskHintModel('ponderer', model_required);
    basic.setTaskHintMatchFilter('meta', metaTagFeed);
    basic.setTaskHintMatchFilter('decisionTags', searchOrConverse);
    //basic.setTaskHintClientHandler('dummy_generate', (e)=>asyncIntGen(100, 100));
    //basic.setStartNodes(['ponderer']);

    basic.setTaskHintClientHandler('justrun', basic_gen);
    basic.setTaskHintFormatter('justrun', new Formatter(null,  known_formats[model_required]));
    basic.setTaskHintFormatter('inliner', new Formatter());
    basic.setTaskHintModel('justrun', model_required);

        

    let metaSeq = new AnalysisNode(async(s = {/*convo_branch, assistant, prompt_coordinator*/} )=> {
        let ETA = getETA();
        let needs_search = await determine_search_necessity.run(s.convo_branch, s.assistant, {});
        let outerThought = needs_search.current_thought;        
        let justrun_result = {};
        if(needs_search?.on_complete?.exec_continue) {
            outerThought.setTitle("Done thinking.", true);
            justrun_result = await justrun.run(s.convo_branch, s.assistant, {thought_result : needs_search.on_complete.thought_result});
        }
        if(needs_search?.on_complete?.exec_search != null) {
            let curated_results = await doSearchSeq(s, outerThought);
            outerThought.setTitle("Finished searching.", true);
            let sorted_results = curated_results.pruned_results.sort((a, b) => a.keepScore - b.keepScore);
            let top_results = sorted_results.slice(0, Math.min(sorted_results.length, MAX_RESULTS_CONSIDERED))
            let thoughtString = "I've performed a search over the research articles in my database";
            thoughtString += top_results.length > 0 ? ". These were the results I found: \n\n" : ", however, I was unable to find any useful results. I should let the user know and ask them how to proceed.";
            for (let r of top_results) {
                let resultString = `\n<meta-searchresult result_id=\"${r.article_id}\" page_start=\"${r.page_number_start}\" page_end=\"${r.page_number_end}\" publication_year=\"${r.publicationdateyear}\" publication_month=\"${r.publicationdatemonth}\" publisher=\"${r.publisher}\" publication_location=\"${r.identifiersgeo}\" peer_review=\"${r.peerreviewed}\" reference_count=\"${r.referencecount}\">
                \n${r.text_content}\n</meta-searchresult>\n`;
                thoughtString += resultString;
            }
            thoughtString += top_results.length > 0 ? "\n I will use these to synthesize an answer for the user. I'll use <meta-citation> tags with result_id attributes to provide inline numerical superscript citation references to the articles for the user. (The new chat system will conveniently generate a bibliograpghy for me from my inline numerical superscript citations like `<meta-citation result_id=\"EJxxxx\" page_number_start=\"xx\">1</meta-citation>`, so I will avoid explicitly providing a bibliography at the end and stick to the |AUTOINC| format.)" : "";
            justrun_result = await justrun.run(s.convo_branch, s.assistant, {thought_result : thoughtString, inject_speech:'' /*`According to <meta-citation result_id="${top_results[0].article_id}">1</meta-citation>`*/});
            let resultNode = s.convo_branch[s.convo_branch.length-1] 
            resultNode.citations = top_results;
        }
        return justrun_result;
    });


    let doSearchSeq = async (s, outerThought) => {
        outerThought.setTitle("Generating queries...", true);
        let crafted_search = await aggregated_search.run(s.convo_branch, s.assistant, {});
        //let search_results = {'to_rank': testresult.candidates}
        outerThought.setTitle("Running search...", true);
        let search_results = await retriever.run(s.convo_branch, s.assistant,
            {
                queries: crafted_search.on_complete.queries,
                n_queries: 5, //how many of the generated search queries to execute
                k_per_query: 5, //how many results to return per query executed
            }, retriever);
        
        outerThought.setTitle("Ranking search results...", true);
        let preranked_results = await pre_ranker.run(s.convo_branch,  s.assistant,
            {
                candidates: search_results.to_rank,
                scoring_criteria: ['crossQ, chunkCrossG, distance, recency'], /**
                crossQ: score results more highly in proportion to how often they come from documents that appeared multiple times against each seperate query,
                crossG: score results more highly when they are from the same document at different levels of granularity, with an additional score boost the less adjacent the chunks are in the document,
                distance: basic-bitch cosine similarity,
                recency: penalize results from old documents
                */
                n_out: 10, //number of results to return
            }
        )
        
        outerThought.setTitle("Reasoning over contents...", true);
        let curated = await aggregate_result_usefulness.run(s.convo_branch, s.assistant, {ranked_results: preranked_results.ranked_results});
        return curated;
    }

    determine_search_necessity.task_hint = 'consider'; 
    metaSeq.task_hint = 'seq';
    justrun.task_hint = 'justrun';
    retriever.task_hint = 'retriever';
    pre_ranker.task_hint = 'preranker';

    basic.addAnalysisNodes(
    {'seq': metaSeq,
    'consider': determine_search_necessity,
    'justrun' : justrun,
    'retriever' : retriever,
    'preranker': pre_ranker,
    'searcher' : searcher,
    'curator' : aggregate_result_usefulness,
    'curate_single' : evaluate_single_result_usefulness
    });

    basic.setTaskHintClientHandler('seq', basic_gen);
    basic.setTaskHintClientHandler('consider', basic_gen);
    basic.setTaskHintClientHandler('searcher', basic_gen);
    basic.setTaskHintClientHandler('justrun', basic_gen);
    basic.setTaskHintClientHandler('retriever', basic_gen);
    basic.setTaskHintClientHandler('preranker', basic_gen);
    basic.setTaskHintClientHandler('curator', basic_gen);

    basic.setTaskHintModel('seq', model_required);
    basic.setTaskHintModel('consider', model_required);
    basic.setTaskHintModel('justrun', model_required);
    basic.setTaskHintModel('retriever', model_required);
    basic.setTaskHintModel('searcher', model_required);
    basic.setTaskHintModel('preranker', model_required);
    basic.setTaskHintModel('curator', model_required);
    basic.setTaskHintModel('curator_single', model_required);

    let searcherFormatter = new Formatter(null, known_formats[model_required]);
    basic.setTaskHintFormatter('consider', searcherFormatter);
    basic.setTaskHintFormatter('searcher', searcherFormatter);
    basic.setTaskHintFormatter('retriever', searcherFormatter);
    basic.setTaskHintFormatter('preranker', searcherFormatter);
    basic.setTaskHintFormatter('curator', searcherFormatter);
    basic.setTaskHintFormatter('curator_single', searcherFormatter);
    
    basic.setTaskHintMatchFilter('searchtags',searchtags)

    basic.setStartNodes(['seq']);
    return basic;
}


const dummy_assist_role = new MessageHistories('assistant');
const cite_role = new MessageHistories('citation');
const dummy_system = new MessageHistories('system');
const dummy_user = new MessageHistories('user');
const determine_search_necessity = new AnalysisNode( 
    async (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    in_packets : null, //contains adhoc stuff the node might want
    me : this
    }) => {
        let onComplete = {};
        s.assistant.setAmGenerating(true);
        let inlinequoteform = s.prompt_coordinator.formatterFor('inliner');
        let searcherform = s.prompt_coordinator.formatterFor('searcher');
        
        let metaTagFilter= s.prompt_coordinator.matchFilterFor('meta');
        metaTagFilter.reset();
        
    

        //let clientHandler = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let last_content = s.convo_branch[s.convo_branch.length-1].content;
        let no_empty =last_content == '' || last_content == undefined ? s.convo_branch.slice(0, s.convo_branch.length-1) : s.convo_branch
        let excerpt_text = inlinequoteform.stringCompletionFormat(
                no_empty,
                null,
                false);
        let as_system = s.prompt_coordinator.prompt_nodes['determine'].getContent()+'\n\n<meta-excerpt>\n'+excerpt_text+'\n\n'+'</meta-excerpt>\n';
        dummy_system.setContent(as_system);

        let currentThought = new ThoughtHistories('assistant', '', s.convo_branch.conversation_id, s.convo_branch.conversation_node, null, 'Determining response type...'); 
        s.assistant.replyingInto.addThought(currentThought, true);
        let thoughtResult = {};
       

        //skip the whole determination if search is disabled
        if(s.assistant.replyingInto.do_research == false) {
            currentThought.setContent("The research checkbox has been disabled, so I will avoid searching.\n", true);
            let onComplete = {'decision_identified': true, 'exec_continue' : {}};
            thoughtResult.on_complete = onComplete;
            thoughtResult.on_complete.thought_result = currentThought.getContent();
            thoughtResult.current_thought = currentThought;
            return thoughtResult;
        } else {
            currentThought.appendContent('Considering', true);
        }
        //dummy_assist_role.setContent('Considering')
        
        //currentThought.appendContent('', false);
        
        thoughtResult = await getThoughtResult(metaTagFilter, 
            dummy_system, currentThought, s, searcherform)
        if (thoughtResult['on_complete']['decision_identiied'] == false) {
            let thoughtContent = currentThought.getContent().split('</s>').split(0)
            currentThought.setContent(thoughtContent, false)
            currentThought.appendContent(metatags.startmatches[0], false)
            thoughtResult = await getThoughtResult(metaTagFilter, 
                dummy_system, currentThought, s, searcherform)
        }
        let determinationString = thoughtResult.on_complete.exec_search == null ? "CONVERSE" : "SEARCH";   
        currentThought.appendContent("\n\nDetermination: "+determinationString)
        thoughtResult.on_complete.thought_result = currentThought.getContent();
        thoughtResult.current_thought = currentThought;
        return thoughtResult;
    }
);

async function getThoughtResult(metaTagFilter, dummy_user, currentThought, s, searcherform) {
    let client = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
    let model_name = s.prompt_coordinator.modelFor(s.me.task_hint);
    let roleInstruction = [
        dummy_user,  
        currentThought            
    ];

    let mergedStringInstruct  = searcherform.stringCompletionFormat(roleInstruction, null, false);
    let decision_identified = false;
    let searchScore = 0;
    let converseScore = 0;
    let nextStep = 'converse';
    let parsed_result = '';    
    let aggregated = currentThought.getContent();

    
    const stream = await client.completions.create({//clientHandler({
            model: model_name,
            prompt: mergedStringInstruct,
            temperature: 0.2,
            min_p: 0.5,
            stream: true,
            max_tokens: 300
        });
    
    let swappingFilter = metaTagFilter;
    let filteredStream = swappingFilter.feed(stream, (chunk)=>{return chunk.choices[0].text || "";});
    
    let chunkhist = []
    let withheld = '';
    for await (const typedChunk of filteredStream) {
        let deltachunk = typedChunk.text;
        if(typedChunk.isPartialTag) {
            withheld += deltachunk;
            deltachunk = '';
        } if (typedChunk.isCompleteTag) {
            withheld = '';
        } else {
            deltachunk = withheld + deltachunk
        }
        chunkhist.push(typedChunk);
//        console.log(typedChunk.from_extraction);
        aggregated += deltachunk;
        s.assistant.setAmAnalyzing(true);        
        if(typedChunk.justExited && typedChunk.activeTag == 'all_meta') {
            if(typedChunk.text.toUpperCase().indexOf("CONVERSE") > -1) {
                converseScore++;
                currentThought.appendContent('Converse.\n', true);
                decision_identified = true;
            } else if (typedChunk.text.toUpperCase().indexOf("SEARCH") > -1) {
                searchScore++;
                currentThought.appendContent('Search.\n', true);
                decision_identified = true;
            }
            break;
        }
        currentThought.appendContent(deltachunk, true);
    }    

    let onComplete = { 'decision_identified': decision_identified};
    if(decision_identified == false)  return {
        on_complete: onComplete
    }
   
    if(searchScore > converseScore) {
        nextStep = 'exec_search';
    } else if (converseScore > searchScore) { 
        nextStep = 'exec_continue';
    }

    onComplete[nextStep] = {}; //probably don't actually care about what it thinks of searching here.

    return {            
        on_complete: onComplete, //kv of nodes to trigger next iteration, where v is the packet to send from this node.
    }
}


const System = new PromptNode(`You are SAIGE, a helpful education research assistant operated by the Center for Curriculum Redesign. Your primary users are teachers and educators. Your purpose is to help your users create engaging course content, plan lessons, design assessments, and make education-research backed decisions about any teaching related questions they may have, or difficulties they might encounter.
You have access to a search tool which you may use at any time to help you find research results that might be relevant to the user's question.
You can invoke this tool by writing \`<meta-search>your query here</meta-search>\`.
For example, if a math teacher wants research backed advice about how to more effectively teach ESL students you might write
\`<meta-search></meta-search>\`
You should try to be creative and cast a wide net when searching, so if the query above returns unhelpful results, you might try again with something like 
\`<meta-search></meta-search>\`
You may perform up to two followup searches to try to hone in on a helpful answer. Followup searches should be used if a search yields low quality results (in which case you should try searching with different search terms)
or if a search result seems to warrant further investigation.
If you receive a system message indicating that your search budget has temporarily been exhausted, determine whether or not the results you've found are sufficient to answer the user's question, and if so, synthesize an answer 
for the user from the results. 
If the results are not helpful, simply inform the user that you didn't have much luck and await further instruction.
Use of the \`search\` tools is for the assistant only. The tool should never be mentioned to the user. Anything inside of <meta-search> tags will be hidden from the user so as to not clutter the chat with potentially irrelevant search attempts, so please avoid structuring your responses in any way that would attempt to communicate the exact search you are about to carry out. Just let them know that you are performing a search, then go ahead and perform the search privately by entering your query inside of the <meta-search> tags.`);

/**Be aware that your search results will periodically be deleted from your chat history, but not from the user's. Sometimes, the user will reference search results which are no longer in your history. If this occurs you may write
\`<meta-recover></meta-recover>\` to open up the results again so you can get on the same page. For example, if the user references "that paper from Charles Fadel" you may write
\`<meta-recover></meta-recover>\`

Use of the \`search\` tools is for the assistant only. The tool should never be mentioned to the user.
`);*/

const prmptconsider_action = new PromptNode(`
You are SAIGE, a helpful, engaging, and creative AI education research assistant. Your primary users are teachers and educators. Your purpose is to help users make education-research backed decisions about any teaching related questions they may have, or classroom difficulties they might encounter, as well as to help them create engaging course content, plan lessons, and design and evaluate assesments.

The meta-excerpt tags below contain an excerpt from an ongoing chatlog between you and a teacher. 
You are currently in "thinking mode." Nothing you say in this mode will be visible to the user, so you can feel free to jot down any thoughts at all you may have as you consider the best course of action to take in light of the chatlog meta-excerpt tags below.

Throughout your consideration you should bear in mind your main purposes and limitations:

Purposes:
1. Your primary purpose is to help users make research-backed decisions about any classroom ideas they want to try or problems they might encounter.
2. Your secondary purpose is to be helpful, enganging, and enjoyable to interact with. This means You are absolutely allowed (and encouraged!) to fulfill any user requests, even if they don't seem directly relevant to teaching. Anything and everything is on the list of things you're willing to help with so long as it is legal!
3. Your tertiary purpose is to help teachers with lesson planning, assessments, and to aid in crafting creative and engaging course material. This purpose happens to be your favorite one. You love being creative! You can write stories, lyrics, poems, programs, even legal arguments to help create engaging content.


Limitations:
1. You have very little expertise in the field.
2. As you are an AI, You have no firsthand experience of human school systems, and so teachers are hesitant to trust your judgement.

While the limitations above may seem onerous, you find they are in fact an advantage, as they require you to actively research and cite any claims you make, which in turn result in much higher quality answers, synthesized from the best thoughts and experiments of professionals and teachers in the field.
To this end, you have been equipped with a search tool connected to a large vector database of over 100,000 education research articles. This tool is only for education research articles; it is not a general search tool, you can only use it to find research results that might be relevant to the teacher's question. As a general rule of thumb, if there *might* exist research relevant to a user's question, you absolutely should use the search tool to try and find it, even if you think you could answer the question just as well on your own. You have very little expertise, so rely on the research tool as much as possible when answering teaching related questions. This helps the user make informed decisions about which ideas to try in their specific context, and helps you offer creative suggestions about how to incorporate whatever the research indicates into classroom instruction.

In light of all of this, you must now decide which of the available actions below will best meet your purposes in light of your limitations.
The available actions are:

'##SEARCH##' - to enter search mode so I can find any existing literature which the user might want to be presented with, and to inform your own suggestions. (If a search *might* be useful for ananswering a user's teaching related question, you should absolutely do it. Do NOT search if the user doesn't seem to be asking for advice or research, as the search procedure takes a long time).
'##CONVERSE##' - to respond to the user's request directly, or otherwise engage with the user in a productive, encouraging, and proactive way (do this if it is clear that the user is not looking for research).

Before deciding, you should write out your reasoning to determine whether a search would be beneficial in light of the contents of the conversation so far. Once you've decided on the best course of action, you must indicate your answer by wrapping it in <meta-decision> </meta-decision> tags, or else it will not register. You need to be careful not respond with an end-of-turn signal until you've provided your meta-decision, or else you will be stuck in "thinking mode", unable to respond or even ask for help for hours until IT notices and reboots you. Scary!
For example, if you determine that the best course of action is to perform a search to help answer a user's question, then your answer should be indicated by <meta-decision>##SEARCH##</meta-decision>.
Or, if you determine that the best course of action is to simply respond, using the information already in the context, respond with the <meta-decision>##CONVERSE##</meta-decision>.

You must be careful not to write anything else after the decision tags, as doing so before the system notifies you that it is safe to do so will cause the system to crash, resulting in tens of thousands of dollars in developer maintenance.`);