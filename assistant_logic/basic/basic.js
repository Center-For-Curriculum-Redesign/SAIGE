import { Convo, Formatter } from '../../chat_history.js';
import { ASST } from '../saigent.js';
import {OpenAI} from "openai";

import * as prompts from './../reasoning_prompts.js';
import { asyncIntGen } from '../../dummy_text.js';


export function basicPromptInst(newAsst, endpoints_available) {
    let model_required = 'TheBloke/SUS-Chat-34B-AWQ';
    //TODO: more robustly handle checks for model serving endpoints
    let model_url = endpoints_available['TheBloke/SUS-Chat-34B-AWQ'][0];
    let basic_gen = new OpenAI({
        apiKey:"EMPTY",
        baseURL: model_url+"/v1/"}
    );
    let basic = new prompts.PromptCoordinator(newAsst);
    basic.addPromptNodes({
        'system' : System
    });
    basic.addAnalysisNodes({'justrun': justrun});
    justrun.task_hint = 'justrun';
    
    basic.setTaskHintClientHandler('justrun', basic_gen);
    basic.setTaskHintFormatter('justrun', new Formatter());
    basic.setTaskHintModel('justrun', model_required);
    //basic.setTaskHintClientHandler('dummy_generate', (e)=>asyncIntGen(100, 100));
    basic.setStartNodes(['justrun']);
    return basic;
}


const justrun = new prompts.AnalysisNode( 
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
        //let clientHandler = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        let active_modded_prompt = formatter.roleChatFormat(
                s.convo_branch,
                s.prompt_coordinator.prompt_nodes['system'].getContent(),
                true);
        const stream = await client.chat.completions.create({//clientHandler({
                model: model_name,
                messages: active_modded_prompt,
                stream: true,
                max_tokens: 1500
            });
        let accumulated = ""
        for await (const chunk of stream) {
            let deltachunk = chunk.choices[0]?.delta?.content || ""
            accumulated += deltachunk;
            s.assistant._on_generate({
                delta_content: deltachunk ,
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







const prepare_action_analysis = new prompts.AnalysisNode( 
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

const System = new prompts.PromptNode(`You are a helpful education research assistant. Your primary users are teachers and educators. Your purpose is to help your users make research backed decisions about any classroom problems they encounter.
You have access to a search tool which you may use at any time to help you find research results that might be relevant to the teacher's question.
You can invoke this tool by writing \`search("your query here")\`.
For example, if a math teacher wants research backed advice about how to more effectively teach ESL students you might write
\`search("Math education for English as a Second Language students")\`
You should try to be creative and cast a wide net when searching, so if the query above returns unhelpful results, you might try again with something like 
\`search("language barriers in math education")\`
You may perform up to two followup searches to try to hone in on a helpful answer. Followup searches should be used if a search yields low quality results (in which case you should try searching with different search terms)
or if a search result seems to warrant further investigation.
If you receive a system message indicating that your search budget has temporarily been exhausted, determine whether or not the results you've found are sufficient to answer the user's question, and if so, synthesize an answer 
for the user from the results. 
If the results are not helpful, simply inform the user that you didn't have much luck and await further instruction.

Be aware that your search results will periodically be deleted from your chat history, but not from the user's. Sometimes, the user will reference search results which are no longer in your history. If this occurs you may write
\`recover("some identifying search result term")\` to open up the results again so you can get on the same page. For example, if the user references "that paper from Charles Fadel" you may write
\`recover("Charles Fadel")\`

Use of the \`search\` and \`recover\` tools is for the assistant's use only, these tools should not even be mentioned to the user! The user CANNOT use the search or recover tools.
`);

const prmptconsider_action = new prompts.PromptNode(`
~END OF EXCERPT~
The above is an excerpt from a chatlog between a teacher and a helpful education research assistant. The assistant's purpose is to help users make research backed decisions about any classroom problems they encounter.
The assistant has very little expertise in the field, but is equipped with a search tool connected to a large vector database of education research articles. It uses this tool frequently to find research results that might be relevant to the teacher's question. Note that the excerpt constitutes the entirety of what the assistant can see at any given time, and that this limitation has bearing on what its next action ought to be. 
Your job is to decide which action the assistant should take next. 
The available actions are
'search("words or phrases likely to appear in research articles relevant to answering the user's query")' - to query over the literature and present results for the user.
'converse()' - to continue casual discussion with the user. 
'recover(access_id)' - to attempt to recover omitted text which was cut from the excerpt so that the assistant may refer to it.

Your response must be a single action provided with the appropriate parameters from the three options provided above (converse, recover, or search).
`);

const prmptconsider_recovery = new prompts.PromptNode(`
~END OF EXCERPT~
The above is an excerpt from a chatlog between a teacher and a helpful education research assistant. The assistant's purpose is to help users make research backed decisions about any classroom problems they encounter.
The assistant has very little expertise in the field, but is equipped with a search tool connected to a large vector database of education research articles. It uses this tool frequently to find research results that might be relevant to the teacher's question. Note that the excerpt constitutes the entirety of what the assistant can see at any given time, and that this limitation has bearing on what its next action ought to be.
In this situation, do you believe the assistant requires access to omitted text in order to best aid the user? End your response with just the text \`Final Answer:
`);



export const thinkalittle = new prompts.PromptCoordinator()
thinkalittle.addPromptNodes({
    'system' : System,
    'consider_action' : prmptconsider_action, 
    'consider_recover' : prmptconsider_recovery
});

thinkalittle.addAnalysisNodes({
    'prepare_action_analysis': prepare_action_analysis
});

thinkalittle.setStartNodes(['prepare_action_analysis']);