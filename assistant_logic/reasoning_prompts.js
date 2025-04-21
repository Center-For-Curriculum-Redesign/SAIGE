import { Formatter } from '../formattings/Formatter.js';
import { asyncIntGen } from "../dummy_text.js";
import { name } from 'ejs';
import { chain, i } from 'mathjs';
import { text } from 'express';
import { ObjectDetectionPipeline } from '@xenova/transformers';

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
        this.matchfilterTaskHints = {};
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
        if(out?.on_complete?.commit != null) {
            this.assistant.commit(out?.on_complete?.commit);
            return false;
        }
        let nodename = requesting_nodename;  
        if(out?.run_again != false) { 
            this.queued_next[nodename] = this.queued_next[nodename] || []
            this.queued_next[nodename].push(out.run_again);
        }
        if(out?.queue_next != null) {
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
    setTaskHintMatchFilter(taskhintname, matchfilter) {
        this.matchfilterTaskHints[taskhintname] = matchfilter;
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
    matchFilterFor(taskhintname) {
        return this.matchfilterTaskHints[taskhintname].clone();
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
    getPrompt(promptname, template_literals=null){
        return this.prompt_nodes[promptname].getContent(template_literals);
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

    run(convo_branch, asst, packets, into_node = null, start_string, ongoing_gen,) {
        return this.buildfunc({
            prompt_coordinator : this.container, // ref to the prompt_coordinator issuing this analysis
            assistant :asst,
            convo_branch : convo_branch, //list of messagehistory objects representing just the current conversation prior to generation,
            into_node : into_node, //the messagehistory node that output should go into (can be null if the AnlysisNode generates its own, or output is otherwise not intended to go into a node)
            string_start : start_string, //string formatted version of convo branch
            generated_text : ongoing_gen, //reference to the currently ongoing text generation,
            in_packets : packets,  //contains adhoc stuff the node might want
            me: this
        })
    } 
}

export class PromptNode {
    /**
     * 
     * @param {*} content The prompt. Supports template literals which can be provided as kv pairs in the template_literals object
     * @param {*} promptsContainer 
     * @param {*} template_literals kv pairs of template literals to inject into the string. If your string is "Hello ${mood} world", then your obj should contain {mood : 'cruel'}
     */
    constructor(content, promptsContainer = null, template_literals = null) {
        if (typeof content !== 'string') {
            throw new Error('Content must be a string.');
        }
        if (template_literals != null && typeof template_literals !== 'object' || Array.isArray(template_literals)) {
            throw new Error('Template literals must be provided as an object.');
        }
        this.content = content;
        this.container = promptsContainer;
        this.tl = template_literals || {};
        let tempContent = content.substring(0);
        tempContent = tempContent.replace(/\$\{(\w+)\}/g, (match, key) => {
            if (key in this.tl) {
                return this.tl[key];
            } else {
                console.warn(`Key '${key}' not found in template literals.`);
                return 'null';
            }
        });
    }

    getRawContent() {
        return this.content;
    }

    getContent(template_literals = null) {
        if (template_literals != null) {
            if(typeof template_literals !== 'object' || Array.isArray(template_literals)) {
                throw new Error('Template literals must be provided as an object.');
            }
            this.tl = template_literals;
        }
        return this.content.replace(/\$\{(\w+)\}/g, (match, key) => {
            if (key in this.tl) {
                return this.tl[key];
            } else {
                console.warn(`Key '${key}' not found in template literals.`);
                return 'null';
            }
        });
    }

    setContainer(cont) {
        this.container = cont;
    }

}

export class WrapFilter {
    /**
     * @param {String} name an identifying name by which to be notified that text is occurring within this wrapFilter
     * @param {String || Array(String)} startTags criteria by which to determine parsing match start for a text stream
     * @param {String || Array(String)} startTags criteria by which to determine parsing match end for a text stream
     * @param {boolean} holdunclosed if true, will withold output inside of tags until the tag has been closed. 
     */
    constructor(name, startTags, endTags, holdunclosed = false) {
        this.raw_wrapf = new RawWrapFilter(name, startTags, endTags)
        this.holdunclosed = holdunclosed
        this.wrappedAccumulation = '';
    }

    reset() {
        this.raw_wrapf.reset();
    }

    clone() {
        return new WrapFilter(this.raw_wrapf.name, this.raw_wrapf.startTags, this.raw_wrapf.endTags, this.holdunclosed);
    }

    get name() { return this.raw_wrapf.name;}

    *processChunk(chunk) { 
        let isAccumulating = false;
        for(let w of this.raw_wrapf.processChunk(chunk)) {
            if(this.holdunclosed && w.exactTag != null) {         
                if( w.justExited) {
                    w.text = this.wrappedAccumulation + w.text; 
                    this.wrappedAccumulation = '';
                    yield w;                 
                } else {
                    this.wrappedAccumulation += w.text;
                }                
            } else {
                yield w;
            }
        }
    }
}

class RawWrapFilter {
    /**
     * @param {String} name an identifying name by which to be notified that text is occurring within this wrapFilter
     * @param {String || Array(String)} startTags criteria by which to determine parsing match start for a text stream
     * @param {String || Array(String)} startTags criteria by which to determine parsing match end for a text stream
     * */
    constructor(name, startTags, endTags) {
        this.startTags = !Array.isArray(startTags) ? [startTags] : startTags
        this.endTags= !Array.isArray(endTags) ? [endTags] : endTags
        this.buffer = '';
        this.name = name;
        this.insideTag = false;
        this.currentTag = null;
    }
    reset() {
        this.buffer = '';
        this.insideTag = false;
        this.currentTag = null;
    }

    clone() {
        return new RawWrapFilter(this.name, this.startTags, this.endTags);
    }

    *processChunk(chunk) {
        this.buffer += chunk;

        let startIndex = 0;
        while (startIndex < this.buffer.length) {
            if (!this.insideTag) {
                const { index: startTagIndex, tag: startTag } = this.findEarliestTag(this.buffer.substring(startIndex), this.startTags);
                if (startTagIndex !== -1) {
                    this.currentTag = startTag;
                    let startres =  { text: this.buffer.substring(startIndex, startIndex + startTagIndex), 
                        activeTag: this.name, exactTag: this.currentTag, justEntered: true, 
                        justExited: false, isPartialTag: false, isCompleteTag: true};
                    yield startres;
                    startIndex += startTagIndex + startTag.length;
                    this.insideTag = true;
                    if(startIndex == this.buffer.length) {
                        this.buffer = '';
                        break;
                    }                    
                } else {
                    let partialTagIndex = this.findPartialTag(this.buffer.substring(startIndex), this.startTags);
                    if (partialTagIndex !== -1) {
                        if(startIndex != partialTagIndex) {
                            let partialOut = { text: this.buffer.substring(startIndex, startIndex + partialTagIndex), 
                                    activeTag: this.name, exactTag: this.currentTag, justEntered: false, 
                                    justExited: false, isPartialTag: true, isCompleteTag: false };                            
                            yield partialOut;
                        }
                        this.buffer = this.buffer.substring(startIndex + partialTagIndex);
                        break;
                    }
                    yield { text: this.buffer.substring(startIndex), 
                        activeTag: null, exactTag : null, justEntered: false, 
                        justExited: false,  isPartialTag: false, isCompleteTag: false};
                    this.buffer = '';
                    break;
                }
            }
            if(this.insideTag) {
                const { index: endTagIndex, tag: endTag } = this.findEarliestTag(this.buffer.substring(startIndex), this.endTags);
                if (endTagIndex !== -1) {
                    let endres = {text: this.buffer.substring(startIndex, startIndex + endTagIndex), 
                        activeTag: this.name, exactTag: this.currentTag, justEntered: false, 
                        justExited: true, isPartialTag: false, isCompleteTag: true};
                    yield endres;
                    startIndex += endTagIndex + endTag.length;                    
                    this.insideTag = false;
                    this.currentTag = null;
                    if(startIndex == this.buffer.length) {
                        this.buffer = '';
                        break;
                    }
                } else {
                    let partialTagIndex = this.findPartialTag(this.buffer.substring(startIndex), this.endTags);
                    if (partialTagIndex !== -1) {
                        if(startIndex != partialTagIndex) {
                            let partialOut = { text: this.buffer.substring(startIndex, startIndex + partialTagIndex), 
                                activeTag: this.name,  exactTag: this.currentTag, justEntered: false, 
                                justExited: false, isPartialTag: true, isCompleteTag: true};
                            yield partialOut;
                        }
                        this.buffer = this.buffer.substring(startIndex + partialTagIndex);
                        break;
                    }
                    yield { text: this.buffer.substring(startIndex), 
                        activeTag: this.name, exactTag: this.currentTag, justEntered: false, 
                        justExited: false, isPartialTag: false, isCompleteTag: false};
                    this.buffer = '';
                    break;
                }
            }
        }
    }

    findEarliestTag(text, tags) {
        let earliestIndex = -1;
        let foundTag = null;
        tags.forEach(tag => {
            const index = text.indexOf(tag);
            if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
                earliestIndex = index;
                foundTag = tag;
            }
        });
        return { index: earliestIndex, tag: foundTag };
    }

    findPartialTag(text, tags) {
        for (let tag of tags) {
            for (let i = 1; i < tag.length; i++) {
                if (text.endsWith(tag.substring(0, i))) {
                    return text.length - i;
                }
            }
        }
        return -1;
    }
}

/**
 * takes chunks of input text, returns the text chunk by input chunk in a wrapper object indicating 
 * which of the WrapFilter delimiter strings that text appears between.
 * 
 * initialize with .init() every time you use it for a new stream.
 */
export class FilteredFeed {
    /**
     * @param {WrapFilter || Array[WrapFiler]} filters a WrapFilter or array of WrapFilters this feed will parse input through
     */
    constructor(filters) {
        this.candidatefilters = Array.isArray(filters) ? filters : [filters];
        this.activeFilter = null
    }

    reset() {
        this.activeFilter = null
        for(let f of this.candidatefilters) {
            f.reset();
        }
    }

    clone() {
        let filterClones = [];
        for(let f of this.candidatefilters) {
            filterClones.push(f.clone());
        }
        return new FilteredFeed(filterClones);
    }

    /**
     * we don't want to reset stop the feed function, but we do want to swap
     * out the tags it's reporting on. getTrack() and setTrack() let us do that 
     * and also let us do equality checks by vague intent.
     * @returns 
     */
    getFilterByName(name) {
        for(let cf of this.candidatefilters) {
            if(cf.name == activeFilterName) {
                return cf;
            }
        }
        return null;
    }
    
   
    /**
     * note, this is a naive setter and doesn't make any assumotions about
     * the state of the provided filters
     * @param {} WrapFilter 
     */
    setActiveFilter(wrapfilter) {
        this.activeFilter = wrapfilter;
    }

    popActiveFilter(filterNameChain) {
        let activeFilterName = this.filterNameChain.pop();
        this.activeFilter = getFilterByName(activeFilterName);
    }

    *throughActiveFilter(textChunk, filterlist = this.candidatefilters) {
        let allResults = {}        
        let result = null;            
        let cf =  filterlist[0];
        let subfilt = filterlist.slice(1);                
        for(let subchunk of cf.processChunk(textChunk)) {
            result = subchunk;
            result.activeTags = result.activeTag != null ? [result.activeTag] : []
            result.exactTags = result.exactTag != null ? [result.exactTag] : []
            result.isPartialTags = result.isPartialTag ? [cf.name] : [];
            result.isCompleteTags = result.isCompleteTags ? [cf.name] : [];
            result.justEnteredTag = result.justEntered ? cf.name : null;
            result.justExitedTag = result.justExited ? cf.name : null;
            
            if(subfilt.length > 0 ) {
                let subresultsProcess = this.throughActiveFilter(subchunk.text, subfilt);
                for(let subresults of subresultsProcess) {
                    result.text = subresults.text
                    result.activeTags = [...result.activeTags, subresults.activeTags]
                    result.exactTags = [...result.exactTags, subresults.exactTags]
                    result.isPartialTags = [...result.isPartialTags, subresults.isPartialTags]
                    result.isCompleteTags = [...result.isCompleteTags, subresults.isCompleteTags]
                    result.justEnteredTag = result.justEntered ? result.name : subresults.justEnteredTag;
                    result.justExitedTag = result.justXited ? result.name : subresults.justEnteredTag;
                    yield result; 
                }
            } else {
                yield result
            }
        }     
    }

    /**
     * 
     * @param {stream} stream
     * @param {function} extractor callback that takes whatever the stream is giving and extracts the text chunk
     * @returns /{
     * filtered_chunk: str,// the input textchunk if it is safe to return, or empty string if a start tag has been matched.
     * will return all of the withheld text as a full sequence once the closing tag is noticed.
     * type: str// one of 'display' if outside of matching tag, or 'tagged' if within a matching tag.
     */
    async * feed(streamin, extractor = this.defaultExtractor) {        
        this.reset();
        //console.log("reset")
        this.debug = [];
        //let stream = await streamin();
        for await (const chunk of streamin) {
            this.debug.push(chunk);
            let deltachunk = extractor(chunk); 
            process.stdout.write(deltachunk) 
            for (let subchunk of this.throughActiveFilter(deltachunk)) {
                let result = {raw_chunk: chunk, ...subchunk}
                yield result
            }
        }        
    }

    defaultExtractor(chunk) {
        return chunk.choices[0].text || "";
    }
}