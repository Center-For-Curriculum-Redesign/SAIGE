import { MessageHistories, ThoughtHistories } from "../../chat_history.js";
import { WrapFilter, AnalysisNode, FilteredFeed, PromptNode } from "../reasoning_prompts.js";
import { QueuedPool } from "../../queuedPool.js";
import { queryEmbRequest } from "../../external_hooks/replicate_embeddings.js";

const prmpt_searcher = new PromptNode(`
The above is an excerpt from a chatlog between a teacher and a helpful education researcher. You are a search assistant AI the researcher relies on to help them find relevant articles for teacher questions. Your purpose is to think of text similar to that which might plausibly appear in research articles that would help the researcher inform the teacher. You submit the strings you come up with for procesing to a vector similarity search database by responding with the command \`<meta-search>relevant string here</meta-search>\`. You may submit multiple search requests at a time by responding with the format:

<meta-search>first hypothetical excerpt that might plausibly appear in a relevant article</meta-search>

<meta-search>another fake excerpt that might plausibly appear in a relevant article</meta-search>

<meta-search>a third one for good measure</meta-search>

Please respond only with wrapped strings relevant to the question(s) posed above. Each query should be independently wrapped in its own <meta-search> tags. Please, do not respond directly to the user, as the user will never read anything you write.
`)


const dummy_searcassist_role = new ThoughtHistories('assistant');
const cite_role = new MessageHistories('citation');
const dummy_system = new MessageHistories('system');
const dummy_user = new MessageHistories('user');

let metasearchtags = new WrapFilter('search', ['<meta-search>'], ['</meta-search>']);
let metaSearchFilter = new FilteredFeed(metasearchtags);


export const aggregated_search = new AnalysisNode( 
    async (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    string_start : null, //string formatted version of convo branch,
    into_node: null,
    generated_text : null, //reference to the currently ongoing text generation,
    in_packets : null, //contains adhoc stuff the node might want
    me : this
    }) => {
        
        s.assistant.setAmGenerating(true);
        s.assistant.setAmAnalyzing(true);
        let search_head = "I'll imagine some hypothetical article text to maximize my odds of finding something: \n\n";
        let activeThoughts = Object.keys(s.assistant.replyingInto.thoughts).length
        let intoNode = s.into_node;
        if(activeThoughts > 0 && intoNode == null) {
            intoNode = s.assistant.replyingInto.thoughts[''+(activeThoughts-1)]            
        } else if (activeThoughts == 0 && intoNode == null) {
            intoNode = convo_branch[convo_branch.length-1].newThought('assistant', true); 
            intoNode.setContent(search_head);           
        }
        search_head = intoNode.getContent() + "\n\n" + search_head;
        intoNode.setContent(search_head, true);

        let c1node = intoNode.newThought('assistant', true);
        let c2node = intoNode.newThought('assistant', true);
        let c3node = intoNode.newThought('assistant', true);
        let candidates1 = searcher.run(s.convo_branch, s.assistant, {}, c1node);
        let candidates2 = searcher.run(s.convo_branch, s.assistant, {}, c2node);
        let candidates3 = searcher.run(s.convo_branch, s.assistant, {}, c3node);
        let results = await Promise.all([candidates1, candidates2, candidates3]);
        s.assistant.commit('', c1node);
        s.assistant.commit('', c2node);
        s.assistant.commit('', c3node);

        let search_queries = []
        let accumulated = ''
        for(let r of results) { 
            search_queries = [...search_queries, ...r.on_complete.queries];
        }
        for(let q of search_queries) accumulated += q+"\n";
        return {
            run_again: false, /*we're only using this to prepare a prompt, so running just once is fine. but you can 
            have this return a json object to indicate the node should run again with that object as its input packets*/
            on_complete: {commit : accumulated, queries: search_queries}, //kv of nodes to trigger next iteration, where v is the packet to send from this node.          
            modded_prompt: null, /* the prompt will be changed to this for all successive calls. 
            Leave null if you want it to just keep doing its thing*/
            request_model: null, //the model type to use for this prompt
            result : accumulated
        }
    }

);

export const searcher = new AnalysisNode( 
    async (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of message and thought history objects representing just the current conversation prior to generation,
    into_node: null, //messagehistory or thoughthistory node this should stream its output into
    string_start : null, //string formatted version of convo branch
    generated_text : null, //reference to the currently ongoing text generation,
    in_packets : null, //contains adhoc stuff the node might want
    me : this
    }) => {
        
        s.assistant.setAmGenerating(true);
        let inlinequoteform = s.prompt_coordinator.formatterFor('inliner');
        let searcherform = s.prompt_coordinator.formatterFor('justrun');
        let client = s.prompt_coordinator.clientHandlerFor('searcher');
        let model_name = s.prompt_coordinator.modelFor('searcher');
        
        let excerpt_text = inlinequoteform.stringCompletionFormat(
                s.convo_branch,
                null,
                false);
        let as_system = '<meta-excerpt>\n'+excerpt_text+'\n</meta-excerpt>'+prmpt_searcher.getContent();
        dummy_system.setContent(as_system)
        dummy_searcassist_role.setContent('Here are some search terms:\n\n<meta-search> ')
        let roleInstruction = [
            dummy_system,  
            dummy_searcassist_role            
        ];


        let mergedStringInstruct  = searcherform.stringCompletionFormat(roleInstruction, null, false);
        const stream = await client.completions.create({//clientHandler({
                model: model_name,
                prompt: mergedStringInstruct,
                min_p: 0.2,
                temperature: 0.5, 
                repetition_penalty: 1.1,
                stream: true,
                max_tokens: 800
            });
        let accumulated = dummy_searcassist_role.getContent();
        let accumulated_raw = '';
        let metasearchfeed = metaSearchFilter.clone();
        let filteredStream = metasearchfeed.feed(stream, (chunk)=>{return chunk.choices[0].text || "";})
        //TODO in Walter's UI: have this append a child thought node to whatever replyingInto happens to be
        //instead of writing directly into the current thought node. 
        let intoNode = s.into_node;
        
        let search_queries = [];
        let currentQuery = '';
        for await (const chunk of filteredStream) {
            let deltachunk = chunk.text;
            accumulated += deltachunk; 
           
            if(chunk.activeTag == 'search') {
                if(intoNode != null) {
                    intoNode.appendContent(deltachunk, true);
                }
                currentQuery += deltachunk;
                if(chunk.justExited) {
                    let splitted = currentQuery.split('\n');
                    for(let l of splitted) {
                        if(l.length > 3) { //disclude short queries.
                            search_queries.push(l);
                            if(intoNode != null) {
                                let cleaned_search_string = "";
                                for(let i = 0; i < search_queries.length; i++) {
                                    cleaned_search_string += "\n--"+search_queries[i];
                                }
                                intoNode.setContent(cleaned_search_string +"\n", true);
                            }
                        }                       
                    }
                    if(search_queries.length >= 5) 
                        break;
                    currentQuery = '';
                }
            }
            s.assistant._on_generate({
                delta_content: deltachunk,
                accumulated: accumulated
            });
            accumulated_raw = accumulated
        }


        /**if the model failed to generate tags correctly, see if we can still extract anything */
        if(search_queries.length == 0) {
            let intag = accumulated_raw.split("<meta-search>")[1]
            if(intag != null) {
                let intagsplit = intag.split("\n")
                for(let l in intagsplit) {
                    if(l.length>0 && search_queries.indexOf(l) == -1)
                        search_queries.push(l)
                }
                if(intoNode != null) {
                    let cleaned_search_string = "";
                    for(let i = 0; i < search_queries.length; i++) {
                        cleaned_search_string += "\n--"+search_queries[i];
                    }
                    intoNode.setContent(cleaned_search_string +"\n", true);
                }
            }
        }
        return {
            run_again: false, /*we're only using this to prepare a prompt, so running just once is fine. but you can 
            have this return a json object to indicate the node should run again with that object as its input packets*/
            on_complete: {commit : '', queries: search_queries}, //kv of nodes to trigger next iteration, where v is the packet to send from this node.          
            modded_prompt: null, /* the prompt will be changed to this for all successive calls. 
            Leave null if you want it to just keep doing its thing*/
            request_model: null, //the model type to use for this prompt
            result : accumulated
        }
    }

);