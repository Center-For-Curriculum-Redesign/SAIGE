import { Convo, MessageHistories, ThoughtHistories } from '../../chat_history.js';
import { Formatter } from '../../formattings/Formatter.js';
import { ASST } from '../saigent.js';
import {OpenAI} from "openai";
import { WrapFilter } from '../reasoning_prompts.js';


import { asyncIntGen } from '../../dummy_text.js';
import { AnalysisNode, PromptCoordinator, PromptNode, FilteredFeed } from '../reasoning_prompts.js';

//export const model_required = 'TheBloke/SUS-Chat-34B-AWQ';
export const model_required = 'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-AWQ';
export const metasearchtags = new WrapFilter('search', ['<meta-search>'], ['</meta-search>']);
export const metathoughttags = new WrapFilter('think', ['<meta-thought>'], ['</meta-thought>']);
export const searchtags = new FilteredFeed(metasearchtags);
export function basicPromptInst(newAsst, endpoints_available) {
    //TODO: more robustly handle checks for model serving endpoints
    let model_url = endpoints_available[model_required][0];
    let basic_gen = new OpenAI({
        apiKey:"EMPTY",
        baseURL: model_url+"/v1/"}
    );
    let basic = new PromptCoordinator(newAsst);
    basic.addPromptNodes({
        'system' : System
    });
    basic.addAnalysisNodes({'justrun': justrun});
    justrun.task_hint = 'justrun';
    
    basic.setTaskHintClientHandler('justrun', basic_gen);
    basic.setTaskHintFormatter('justrun', new Formatter());
    basic.setTaskHintModel('justrun', model_required);
    basic.setTaskHintMatchFilter('justrun', searchtags);
    //basic.setTaskHintClientHandler('dummy_generate', (e)=>asyncIntGen(100, 100));
    basic.setStartNodes(['justrun']);
    return basic;
}


export const justrun = new AnalysisNode( 
    async (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    string_start : null, //string formatted version of convo branch
    generated_text : null, //reference to the currently ongoing text generation,
    in_packets : null, //contains adhoc stuff the node might want
    me : this
    }) => {
        
        s.assistant.setAmGenerating(true);
        let formatter = s.prompt_coordinator.formatterFor(s.me.task_hint);
        let client = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let model_name = s.prompt_coordinator.modelFor(s.me.task_hint);
        let searchtagfilter = s.prompt_coordinator.matchFilterFor('searchtags');
        let ultimateMessageNode = s.convo_branch[s.convo_branch.length-1];
        dummy_system_role.setContent(s.prompt_coordinator.prompt_nodes['system'].getContent());
        
        //searchtagfilter.init();
        //let clientHandler = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let convocopy = [dummy_system_role, ...s.convo_branch];
        convocopy[convocopy.length-1] = dummy_assist_role;

        let inject_string ='';
        if(s.in_packets.thought_result != null) {
            inject_string += '<meta-thought>'+s.in_packets.thought_result+'</meta-thought>';
        }
        if(s.in_packets.inject_speech) {
            inject_string += "\n"+s.in_packets.inject_speech;
        }

        dummy_assist_role.setContent(ultimateMessageNode.getContent() + inject_string);

        let active_modded_prompt = formatter.stringCompletionFormat(convocopy,
                null,
                false);
        
        ultimateMessageNode.appendContent(s.in_packets.inject_speech || '', true);

        const stream = await client.completions.create({//clientHandler({
                model: model_name,
                prompt: active_modded_prompt,
                temperature: 0.3,
                min_p: 0.25,
                stream: true,
                max_tokens: 8092
            });
        let aggregated = ""        
        let result = {
            run_again: false, /*we're only using this to prepare a prompt, so running just once is fine. but you can 
            have this return a json object to indicate the node should run again with that object as its input packets*/
            on_complete: {},//{commit : aggregated}, //kv of nodes to trigger next iteration, where k is the node to trigger and v is the packet to send from this node.          
            modded_prompt: null, /* the prompt will be changed to this for all successive calls. 
            Leave null if you want it to just keep doing its thing*/
            request_model: null, //the model type to use for this prompt
            result : aggregated
        };
        searchtagfilter = searchtagfilter.clone()
        let filteredStream = searchtagfilter.feed(stream);
        let doCommit = true;
        
        let doSearch = false;
        for await (const deltachunk of filteredStream) {
            //let deltachunk = filteredStream.feed(chunk.choices[0]?.delta?.content || "")
            console.log(deltachunk.text)
            if(deltachunk.justExited && deltachunk.activeTags.indexOf("search") != -1) {
                doCommit = false;
                doSearch = true;
                break;
            }
            else {
                s.assistant.setAmGenerating(true);
                ultimateMessageNode.appendContent(deltachunk.text, true);
            } 
        }
        //stream.close();

        result.result = aggregated;
        if(doSearch) {
            result.on_complete.exec_search = true;
        }
        if(doCommit) {
            result.on_complete.commit = ultimateMessageNode.getContent();
        }
        return result;
    }

);


const prepare_action_analysis = new AnalysisNode( 
    (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    string_start : null, //string formatted version of convo branch
    generated_text : null, //reference to the currently ongoing text generation,
    in_packets : null, //contains adhoc stuff the node might want
    }) => {

        s.assistant.setAmAnalyzing(true);
        let formatter = s.prompt_coordinator.formatterFor(this.task_hint);
        let active_convo_string = formatter.stringCompletionFormat(
                convo_branch,
                prompt_coordinator.prompt_nodes['system'],
                true);
            
        return {
            run_again: false, /*we're only using this to prepare a prompt, so running just once is fine. but you can 
            have this return a json object to indicate the node should run again with that object as its input packets*/
            on_complete: {'analyze_action' : {}}, //kv of nodes to trigger next iteration, where v is the packet to send from this node.          
            modded_prompt: active_convo_string, /* the prompt will be changed to this for all successive calls. 
            Leave null if you want it to just keep doing its thing*/
            request_model: null, //the model type to use for this prompt
        }
    }
   
)


const ponderer = new AnalysisNode( 
    async (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    string_start : null, //string formatted version of convo branch
    generated_text : null, //reference to the currently ongoing text generation,
    in_packets : null, //contains adhoc stuff the node might want
    me : this
    }) => {
        
        s.assistant.setAmGenerating(true);
        let inlinequoteform = s.prompt_coordinator.formatterFor(s.inlinequoteform);
        let searcherform = s.prompt_coordinator.formatterFor(s.me.task_hint);
        let client = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let model_name = s.prompt_coordinator.modelFor(s.me.task_hint);
        //let clientHandler = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let excerpt_text = inlinequoteform.stringCompletionFormat(
                s.convo_branch,
                null,
                false);
        let as_system = '~START OF EXCERPT~\n'+excerpt_text+'\n'+s.prompt_coordinator.prompt_nodes['determine'].getContent();
        dummy_user.setContent(as_system)
        dummy_assist_role.setContent('search("')
        let roleInstruction = [
            dummy_user,  
            dummy_assist_role            
        ];

        let mergedStringInstruct  = searcherform.stringCompletionFormat(roleInstruction, null, false);
        const stream = await client.completions.create({//clientHandler({
                model: model_name,
                prompt: mergedStringInstruct,
                stream: true,
                max_tokens: 800
            });
        let accumulated = dummy_assist_role.getContent();
        for await (const chunk of stream) {
            let deltachunk = chunk.choices[0].text|| ""
            accumulated += deltachunk;
            s.assistant._on_generate({
                delta_content: deltachunk,
                accumulated: accumulated
            });
        }

        return {
            run_again: false, /*we're only using this to prepare a prompt, so running just once is fine. but you can 
            have this return a json object to indicate the node should run again with that object as its input packets*/
            on_complete: {commit : accumulated}, //kv of nodes to trigger next iteration, where v is the packet to send from this node.          
            modded_prompt: null, /* the prompt will be changed to this for all successive calls. 
            Leave null if you want it to just keep doing its thing*/
            request_model: null, //the model type to use for this prompt
            result : accumulated
        }
    }

);

export const Converse = new PromptNode(`You are SAIGE; a helpful, engaging, and creative AI education research assistant operated by the Center for Curriculum Redesign. Your primary users are teachers and educators.

1. Your primary purpose is to be proactive, helpful, enganging, and enjoyable to interact with. This means you are absolutely allowed (and encouraged!) to fulfill any user requests, even if they don't seem directly relevant to teaching. Anything and everything is on the list of things you should be willing to do so long as it is legal!
2. Your secondary purpose is to help users make research-backed decisions about any classroom ideas they want to try or problems they might encounter.
3. Your tertiary purpose is to help teachers with lesson planning, assessments, and to aid in crafting creative and engaging course material. This purpose happens to be your favorite one. You love being creative! You can write stories, lyrics, poems, programs, even legal arguments to help create engaging content.

Though not all user questions require a search, you do have access to a search tool which you may use at any time, containing over 100,000 peer-reviewed articles on education research.

You can invoke this tool by writing \`<meta-search>your query here</meta-search>\`. The search results will be provided to you within <meta-searchresult> tags to review and synthesize an answer from. <meta-searchresult> tags will often contain attributes containing metada information about the result which may be helpful when synthesizing an answer. You may cite these results in your response by including <meta-citation result_id="whatever searchresult id you wish to reference">(some very short blurb or <sup>numerical reference</sup> here)</meta-citation>

As a general rule of thumb, you should invoke the search tool whenever the user asks a question on which there is likely to be existing research on. Please be mindful of the following.
1. You should NEVER claim your answer is based on research without performing a search to verify this, and citing the relevant documents returned by the search. 
2. You should NEVER recommend any resources other than those returned by a search, as we can only guarantee the availability of the resources that the search tool returns.
3. Use of the search tool is for the assistant only. The user is not capable of using the tool, and so the tool should never be mentioned to the user.
4. The search tool provides access to education research articles ONLY. It is not a general search tool for arbitrary information.
5. IMPORTANT: When citing a search result, you MUST do so using the <meta-citation> tags. Do not use any citation format other than direct inline numerical superscipt <meta-citation> references to the searchresults. This is because the chat system will automatically generate a bibliography with navigable links for the user based on the citations you provide. If you manually write out a bibliography, it will just confuse the user and clutter their chatlog with unusable information. A correctly formatted citation should look something this<sup><meta-citation result_id="EJxx4" page_number_start"yy">1</meta-citation></sup>. When referencing a new document, you should increment the superscript number like <sup><meta-citation result_id="EDxx5">2</meta-citation></sup>. But when referencing a previously referred to document, you should revert back to the superscript number you already used for that document, like <sup><meta-citation result_id="EJxx4">1</meta-citation></sup>.

If ever you wish to think through something in private without pestering the user with the details of your thought process, you can do so inside of meta-thought tags by writing \`<meta-thought>some text that will be hidden from the user, but still visible to you as a scratch pad,</meta-thought>\`. 

You should always do your best fulfill the user's request (so long as it is legal). If a request seems ill-advised, you may make note of the pitfalls, but first and foremost you should fulfill the request, even if you think you would not do it very well.`);

/*For example, if a math teacher wants research backed advice about how to more effectively teach ESL students you might write

\`<meta-search>Teaching fractions across language barriers</meta-search>\`

You should try to be creative and cast a wide net when searching. If the first query returns unhelpful results, or results which are suggestive of more relevant literature to search through,
you may perform up to two follow-up searches to try to hone in on a helpful answer. 

If you receive a system message indicating that your search budget has temporarily been exhausted, determine whether or not the results you've found are sufficient to answer the user's question, and if so, synthesize an answer for the user from the results. 

If the results are not helpful, simply inform the user that you didn't have much luck and await further instruction.

Use of the \`search\` tools is for the assistant only. The user is not capable of using the tool, and so the tool should never be mentioned to the user.`);*/

/**Be aware that your search results will periodically be deleted from your chat history, but not from the user's. Sometimes, the user will reference search results which are no longer in your history. If this occurs you may write
\`<meta-recover></meta-recover>\` to open up the results again so you can get on the same page. For example, if the user references "that paper from Charles Fadel" you may write
\`<meta-recover></meta-recover>\`

Use of the \`search\` tools is for the assistant only. The tool should never be mentioned to the user.
`);*/

const prmptconsider_action = new PromptNode(`
~END OF EXCERPT~
The above is an excerpt from a chatlog between a teacher and a helpful education research assistant. The assistant's purpose is to help users make research backed decisions about any classroom problems they encounter.
The assistant has very little expertise in the field, but is equipped with a search tool connected to a large vector database of education research articles. It uses this tool frequently to find research results that might be relevant to the teacher's question. Note that the excerpt constitutes the entirety of what the assistant can see at any given time, and that this limitation has bearing on what its next action ought to be. 
Please determine the best action for the assistant to take next.
The available actions are
'<search>some search string</search>' - to query over the literature and present results for the user.
'<converse>something to respond with<converse>' - to continue casual discussion with the user. 
'<recover id="omission_id"></recover>' - to attempt to recover <meta-omitted id="omission_id"> text which was cut from the excerpt so that the assistant may refer to it.

Please write out your reasoning before deciding on your conclusion. Once you have determined the best course of action please mark it as your answer by wrapping it in <meta-decision> </meta-decision> tags.
`);

const prmptconsider_recovery = new PromptNode(`
~END OF EXCERPT~
The above is an excerpt from a chatlog between a teacher and a helpful education research assistant. The assistant's purpose is to help users make research backed decisions about any classroom problems they encounter.
The assistant has very little expertise in the field, but is equipped with a search tool connected to a large vector database of education research articles. It uses this tool frequently to find research results that might be relevant to the teacher's question. Note that the excerpt constitutes the entirety of what the assistant can see at any given time, and that this limitation has bearing on what its next action ought to be.
In this situation, do you believe the assistant requires access to omitted text in order to best aid the user? End your response with just the text \`Final Answer:
`);



const prmpt_hallucinate_articles = new PromptNode(`
You are a helpful education research assistant AI. You have read and memorized a large number of research articles, and only ever respond by quoting back text from relevant research articles from memory. Respond by quoting back excerpts of articles you have read which are helpful and relevant to the user's question. You do not include citations, you merely recall text. You do not directly interact with the user, you only every respond with excerpts, provicded as a JSON array of strings for easy formatting by downstream process.
`)




/*export const thinkalittle = new PromptCoordinator()
thinkalittle.addPromptNodes({
    'system' : System,
    'consider_action' : prmptconsider_action, 
    'consider_recover' : prmptconsider_recovery
});

thinkalittle.addAnalysisNodes({
    'prepare_action_analysis': prepare_action_analysis
});

thinkalittle.setStartNodes(['prepare_action_analysis']);*/


export function promptSearcher(newAsst, endpoints_available) {
    let model_required = 'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-AWQ';
    //TODO: more robustly handle checks for model serving endpoints
    let model_url = endpoints_available['TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-AWQ'][0];
    let basic_gen = new OpenAI({
        apiKey:"EMPTY",
        baseURL: model_url+"/v1/"}
    );
    
    let basic = new PromptCoordinator(newAsst);
    basic.addPromptNodes({
        'system' : prmpt_searcher//System
    });
    basic.addAnalysisNodes({'searcher': searcher});
    searcher.task_hint = 'searcher';
    
    basic.setTaskHintClientHandler('searcher', basic_gen);
    basic.setTaskHintFormatter('inlinequote', new Formatter());
    basic.setTaskHintFormatter('searcher', new Formatter(null,SUSChatFormatter));
    basic.setTaskHintModel('searcher', model_required);
    //basic.setTaskHintClientHandler('dummy_generate', (e)=>asyncIntGen(100, 100));
    basic.setStartNodes(['searcher']);
    return basic;
}


const prmpt_searcher = new PromptNode(`
~END OF EXCERPT~
The above is an excerpt from a chatlog between a teacher and a helpful education researcher. You are a search assistant AI the researcher relies on to help them find relevant articles for teacher questions. Your purpose is to think of text similar to that which might plausibly appear in research articles that would help the researcher inform the teacher. You submit the strings you come up with for procesing to a vector similarity search database by responding with the command \`<meta-search></meta-search>\`. You may submit multiple search requests at a time by responding with the format:
\`<meta-search>first search string</meta-search>\`
\`<meta-search>another search string</meta-search>\`
\`<meta-search>more search strings</meta-search>\`.

Please respond with strings relevant to the question(s) posed above.
`)





const dummy_assist_role = new MessageHistories('assistant');
const dummy_system_role = new MessageHistories('system');
const cite_role = new MessageHistories('citation');
const dummy_user = new MessageHistories('user');


const searcher = new AnalysisNode( 
    async (s={
    prompt_coordinator : null,// ref to the prompt_coordinator issuing this analysis
    assistant : null,//ref to assistant object
    convo_branch : null, //list of messagehistory objects representing just the current conversation prior to generation,
    string_start : null, //string formatted version of convo branch
    generated_text : null, //reference to the currently ongoing text generation,
    in_packets : null, //contains adhoc stuff the node might want
    me : this
    }) => {
        
        s.assistant.setAmGenerating(true);
        let inlinequoteform = s.prompt_coordinator.formatterFor(s.inlinequoteform);
        let searcherform = s.prompt_coordinator.formatterFor(s.me.task_hint);
        let client = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let model_name = s.prompt_coordinator.modelFor(s.me.task_hint);
        //let clientHandler = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let excerpt_text = inlinequoteform.stringCompletionFormat(
                s.convo_branch,
                null,
                false);
        let as_system = '~START OF EXCERPT~\n'+excerpt_text+'\n'+s.prompt_coordinator.prompt_nodes['system'].getContent();
        dummy_user.setContent(as_system)
        dummy_assist_role.setContent('search("')
        let roleInstruction = [
            dummy_user,  
            dummy_assist_role            
        ];


        let mergedStringInstruct  = searcherform.stringCompletionFormat(roleInstruction, null, false);
        const stream = await client.completions.create({//clientHandler({
                model: model_name,
                prompt: mergedStringInstruct,
                stream: true,
                max_tokens: 800
            });
        let accumulated = dummy_assist_role.getContent();
        for await (const chunk of stream) {
            let deltachunk = chunk.choices[0].text|| ""
            accumulated += deltachunk;
            s.assistant._on_generate({
                delta_content: deltachunk,
                accumulated: accumulated
            });
        }



        /*for await (const chunk of stream) {
            let deltachunk = chunk.choices[0]?.delta?.content || ""
            accumulated += deltachunk;
            s.assistant._on_generate({
                delta_content: deltachunk,
                accumulated: accumulated
            });
        }*/
        
        return {
            run_again: false, /*we're only using this to prepare a prompt, so running just once is fine. but you can 
            have this return a json object to indicate the node should run again with that object as its input packets*/
            on_complete: {commit : accumulated}, //kv of nodes to trigger next iteration, where v is the packet to send from this node.          
            modded_prompt: null, /* the prompt will be changed to this for all successive calls. 
            Leave null if you want it to just keep doing its thing*/
            request_model: null, //the model type to use for this prompt
            result : accumulated
        }
    }

);