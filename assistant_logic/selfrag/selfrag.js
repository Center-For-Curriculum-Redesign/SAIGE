import { Convo, MessageHistories } from '../../chat_history.js';
import { Formatter } from '../../formattings/Formatter.js';
import { ASST } from '../saigent.js';
import {OpenAI} from "openai";

import * as prompts from '../reasoning_prompts.js';
import { asyncIntGen } from '../../dummy_text.js';

const model_required = 'selfrag/selfrag_llama2_13b';
const stop_on= ['[Retrieval]', '[Irrelevant]'];

const formatRAGInstruct= {
    'role_strings': {
        'system' : '### Instruction:\n',
        'user': '### Input:\n',
        'assistant': '### Response:\n',
        'citation': '<paragraph>'
    },
    'pre_role': {
        'system' : '',
        'user' : '\n',
        'assistant' : '\n',
        'citation': ''
    },
    'post_role': {
        'user' : '\n',
        'system' : '\n',
        'assistant' : '',//empty because no newlines between citation entries
        'citation' : '</paragraph>'
    }
}

export const teacherAssistant = {
    'system': '',
    'role_strings': {
        'user': '\nTeacher: ',
        'assistant': '\nResearchAssistant: '
    },
    'pre_role': {
        'user' : '\n',
        'assistant' : '\n',
    },
    'post_role': {
        'user' : '\n',
        'assistant' : '\n'
    }
};


export function selfRagPromptInst(newAsst, endpoints_available) {
    let model_required = 'selfrag/selfrag_llama2_13b';
    //TODO: more robustly handle checks for model serving endpoints
    let model_url = endpoints_available[model_required][0];
    let stopThink = new OpenAI({
        apiKey:"EMPTY",
        baseURL: model_url+"/v1/"}
    );
    let basic = new prompts.PromptCoordinator(newAsst);
    basic.addPromptNodes({
        'system' : System
    });
    basic.addAnalysisNodes({'ragInstruct': justrun});
    justrun.task_hint = 'ragInstruct';
    
    basic.setTaskHintClientHandler('ragInstruct', stopThink);
    basic.setTaskHintFormatter('ragInstruct', new Formatter(null, formatRAGInstruct));
    basic.setTaskHintFormatter('convoQuote', new Formatter(null, teacherAssistant));
    basic.setTaskHintModel('ragInstruct', model_required);
    //basic.setTaskHintClientHandler('dummy_generate', (e)=>asyncIntGen(100, 100));
    basic.setStartNodes(['ragInstruct']);
    return basic;
}

const sysrole = new MessageHistories('system');
const citerole = new MessageHistories('citation');
const dummy_user = new MessageHistories('user');
const dummy_assist_role = new MessageHistories('assistant', '');

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
        let convoQuoteFormatter = s.prompt_coordinator.formatterFor('convoQuote');
        let ragFormatter = s.prompt_coordinator.formatterFor(s.me.task_hint);
        let client = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        //let model_name = s.prompt_coordinator.modelFor(s.me.task_hint);
        //let clientHandler = s.prompt_coordinator.clientHandlerFor(s.me.task_hint);
        
        //let instructBranch = [sysInstruct, ...s.convo_branch];

        let roleQuoted_prompt = convoQuoteFormatter.stringCompletionFormat(
                [s.convo_branch[s.convo_branch.length - 1]],//s.convo_branch,
                null,
                false);

        sysrole.setContent(s.convo_branch[s.convo_branch.length - 1].getContent())//s.prompt_coordinator.prompt_nodes['system'].getContent());
        //dummy_user.setContent(roleQuoted_prompt);
        let ragInstructPrompt = [
            sysrole, 
            //dummy_user,
            dummy_assist_role
        ];

        let stringCompletionFormat = ragFormatter.stringCompletionFormat(ragInstructPrompt, null, false)
        const stream = await client.completions.create({//clientHandler({
                model: model_required,
                prompt: stringCompletionFormat,
                stream: true,
                max_tokens: 800,
                n:1,
                best_of:4,
                skip_special_tokens: false,
                early_stopping: true,
                stop_token_ids: [
                    32001, //'[Retrieval]',
                    32003, //'[Irrelevant]'
                ]
            });
        let accumulated = ""
        for await (const chunk of stream) {
            let deltachunk = chunk.choices[0]?.text || ""
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


const System = new prompts.PromptNode("Given this chat history between Teacher and ResearchAssistant, generates an informative, well-justified, and engaging response as ResearchAssistant, making sure to consu .");
//const System = new prompts.PromptNode("Given this chat history between Teacher and ResearchAssistant, generates an informative, well-justified, and engaging response as ResearchAssistant, making sure to consu .");