import { Formatter } from "../chat_history.js";

/**
* maintains a loose collection of PromptNodes and Analysis nodes that may reference one another. 
* PromptNodes just contain text. 
* Analysis nodes look at the conversation history and specify how to inject which prompts under which conditions.
*/
export class PromptCoordinator{
    
    constructor(assistant) {
        this.prompt_nodes = {};
        this.analysis_nodes = {};
        this.queued_next = {};
        this.start_nodes = [];
        this.queued_current = {};
        this.default_formatter = new Formatter(null);
        this.assistant = assistant;
        if(this.assistant != null) {
            this.assistant.setPromptCoordinator(this);
        }
        this.clientTaskHints = {};
        this.modelTaskHints = {};
        this.formatterTaskHints = {};
    }

    begin(convo_branch) {
        this.queued_current = this.queued_next; 
        this.queued_next = {};
        this.start_nodes.forEach(nodename=>{
            let node = this.analysis_nodes[nodename];
            let node_out = node.run(convo_branch, this.assistant, {}, "", "", );
            let keepGoing = this.handleOutputRequest(node_out, nodename);
            if(!keepGoing) 
                return;
        });
    }
    
    iterate(convo_branch) {
        this.queued_current = this.queued_next; 
        this.queued_next = {};
        for(nodename in queued_current) {
            let node = this.analysis_nodes[nodename];
            let node_out = node.run(convo_branch, assistant, {}, "", "", );
            let keepGoing = this.handleOutputRequest(node_out, nodename);
            if(!keepGoing) 
                return;
        }
    }

    async handleOutputRequest(output_request, requesting_nodename) {
        let out = await output_request;
        if(out?.on_complete?.commit) {
            this.assistant.commit(out?.on_complete?.commit);
            return false;
        }
        let nodename = requesting_nodename;  
        if(out.run_again != false) { 
            this.queued_next[nodename] = this.queued_next[nodename] || []
            this.queued_next[nodename].push(out.run_again);
        }
        if(out.queue_next != null) {
            for(let k in out.on_complete) {
                this.queued_next[k] = this.queued_next[k] || []
                this.queued_next[k].push(out.queue_next[k]);
            }
        }
    } 
    setTaskHintClientHandler(taskhintname, client) {
        this.clientTaskHints[taskhintname] = client;
    }
    setTaskHintFormatter(taskhintname, formatter) {
        this.formatterTaskHints[taskhintname] = formatter;
    }
    setTaskHintModel(taskhintname, model) {
        this.modelTaskHints[taskhintname] = model;
    }

    clientHandlerFor(taskhintname) {
        return this.clientTaskHints[taskhintname];
    }
    formatterFor(taskhintname) {
        return this.formatterTaskHints[taskhintname] || this.default_formatter;
    }
    modelFor(taskhintname) {
        return this.modelTaskHints[taskhintname];
    }

    /**
     * expects named key value pairs of PromptNode names and 
     * PromptNodes
     */
    addPromptNodes(promptkv) {
        for(let k in promptkv) {
            this.prompt_nodes[k] = promptkv[k]
            promptkv[k].setContainer(this);
        }
    }

    /**returns the text for the prompt of the given name */
    getPrompt(promptname){
        return this.prompt_nodes[promptname].getContent();

    }
    /**
     * expects named key value pairs of AnalysisNode names and 
     * AnalysisNode
     */
    addAnalysisNodes(nodekv) {
        for(let k in nodekv) {
            this.analysis_nodes[k] = nodekv[k]
            nodekv[k].setContainer(this);
            nodekv[k].nodeName = k;
        }
    }

    setStartNodes(setNodes) {
        this.start_nodes = setNodes;
        for(let v of this.start_nodes) {
            this.analysis_nodes[v].setContainer(this);
        }
    }
}


/**
 * initialized with a kv pair of named callbacks.
 * each callback will be provided with the full text that was submitted to the model,
 * the ongoing generation by the model, 
 * and token logits if available.
 * the analysis node will be called once per autoregressive prediction.
 */
export class AnalysisNode {
    /*increments once per autorgressive generation. 
    resets whenever the assitant commits to a reply*/
    callCount = 0;
    /**
     * @param {CallableFunction} buildfunc a callback, will be given an object as input,
     * should return an object as output. Intended for building and modifying 
     * that object should specify what the next analysis node to trigger is
     * @param {string} task_hint optional hint as to the type of task this node performs, 
     * so variants of the prompt_coordinator can feed it different formatter_templates / models.
     */
    constructor(buildfunc, task_hint) {        
        this.buildfunc = buildfunc.bind(this);
        this.task_hint = null;
    }

    setContainer(cont) {
        this.container = cont;
    }

    run(convo_branch, packets, start_string, ongoing_gen) {
        return this.buildfunc({
            prompt_coordinator : this.container, // ref to the prompt_coordinator issuing this analysis
            assistant : this.container.assistant,
            convo_branch : convo_branch, //list of messagehistory objects representing just the current conversation prior to generation,
            string_start : start_string, //string formatted version of convo branch
            generated_text : ongoing_gen, //reference to the currently ongoing text generation,
            in_packets : packets,  //contains adhoc stuff the node might want
            me: this
        })
    }

}

export class PromptNode {
    constructor(content, promptsContainer = null) {
        this.content = content;
        this.container = promptsContainer;
    }

    getContent() {
        return this.content;
    }

    setContainer(cont) {
        this.container = cont;
    }

}

