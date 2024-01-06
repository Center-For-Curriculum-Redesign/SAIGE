import { Formatter } from '../formattings/Formatter.js';
import { asyncIntGen } from "../dummy_text.js";

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
        return this.matchfilterTaskHints[taskhintname];
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

    run(convo_branch, asst, packets, start_string, ongoing_gen) {
        return this.buildfunc({
            prompt_coordinator : this.container, // ref to the prompt_coordinator issuing this analysis
            assistant :asst,
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

/**
 * takes chunks of input text, returns the text chunk by input chunk in a wrapper object indicating 
 * which of the delimiter strings that text appears between.
 * 
 * initialize with .init() every time you use it for a new stream.
 */
export class MatchFilter {
    /**
     * 
     * @param {String || Array(String)} start criteria by which to determine parsing match start for a text stream
     * @param {String || Array(String)} end criteria by which to determine parsing match end for a text stream
     */
    constructor(start, end) {
        this.startmatches = start;
        this.endmatches = end;
        this.matchtrack = new MatchOnTrack(this.startmatches, this.endmatches);
    }

    reset() {
        this.matchtrack.reset();
    }

    /**
     * we don't want to reset stop the feed function, but we do want to swap
     * out the tags it's reporting on. getTrack() and setTrack() let us do that 
     * and also let us do equality checks by vague intent.
     * @returns 
     */
    getTrack() {
        return this.matchtrack;
    }

    /**
     * note, this is a naive setter and doesn't make any assumotions about
     * the state of the provided matchtrack.
     * @param {} matchTrack 
     */
    setTrack(matchTrack) {
        this.matchtrack = matchTrack;
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
     async * feed(streamin, extractor) {
        let accumulated_startbase = '';
        let accumulated_tagbase = '';
        let accumulated_raw = '';
        let accumulated_raw_chunks = []
        this.reset();
        //let stream = await streamin();
        for await (const chunk of streamin) {
            let deltachunk = extractor(chunk); 
            let parser = this.matchtrack;           
            let typedChunks = this.feedOne(deltachunk);
            accumulated_raw += deltachunk;
            accumulated_raw_chunks.push(deltachunk)
            if(typedChunks.prevstate <= TAG_INNER && typedChunks.base_text != null) {
                let thischunk = typedChunks.base_text||'';
                accumulated_startbase += thischunk; 
                yield {
                    chunk: thischunk, 
                    type: 'base', 
                    accumulated: false,
                    from_extraction : deltachunk,
                    raw_aggregate : accumulated_raw,
                    raw_chunk_aggregate : accumulated_raw_chunks,
                    criteria_index_triggered : typedChunks.criteriaIndex,
                    current_matchtrack: parser
                }
                
            }

            if(typedChunks.state == TAG_INNER && typedChunks.criteriaIndex >-1 && typedChunks.prevstate < TAG_INNER) {
                let thischunk = typedChunks.base_text||'';
                yield {
                    parsed_result: accumulated_startbase,
                    chunk: thischunk,
                    type: 'base', 
                    accumulated: true,
                    from_extraction : deltachunk,
                    raw_aggregate : accumulated_raw,
                    raw_chunk_aggregate : accumulated_raw_chunks,
                    raw_chunk : chunk,
                    criteria_index_triggered : typedChunks.criteriaIndex,
                    criteria_name_triggered : typedChunks.criteria_name_triggered,
                    current_matchtrack: parser
                    
                }
                accumulated_startbase='';
            }
           
            if(typedChunks.prevstate >= TAG_INNER && typedChunks.state <= POST_TAG) {
                let thischunk = typedChunks.tagged_text||'';
                accumulated_tagbase += thischunk; 
                yield {
                    chunk: thischunk, 
                    type: 'tagged', 
                    accumulated: false,
                    from_extraction : deltachunk,
                    raw_aggregate : accumulated_raw,
                    raw_chunk_aggregate : accumulated_raw_chunks,
                    raw_chunk : chunk,
                    criteria_index_triggered : typedChunks.criteriaIndex,
                    current_matchtrack: parser
                }
                if(typedChunks.state >= POST_TAG) {
                    this.reset()
                    yield {
                        chunk: thischunk,
                        parsed_result: accumulated_tagbase, 
                        type: 'tagged', 
                        accumulated: true,
                        from_extraction : deltachunk,
                        raw_aggregate : accumulated_raw,
                        raw_chunk_aggregate : accumulated_raw_chunks,
                        raw_chunk : chunk,
                        criteria_index_triggered : typedChunks.criteriaIndex,
                        criteria_name_triggered : typedChunks.criteria_name_triggered,
                        current_matchtrack: parser
                    }
                    accumulated_tagbase = '';                    
                }
            }
        }        
    }

    /**
     * 
     * @param {string} textchunk 
     * @returns /{
     * filtered_chunk: str,// the input textchunk if it is safe to return, or empty string if a start tag has been matched.
     * will return all of the withheld text as a full sequence once the closing tag is noticed.
     * type: str// one of 'display' if outside of matching tag, or 'tagged' if within a matching tag.
     */
    feedOne(textchunk) {
        return this.matchtrack.buildMatch(textchunk);
    }

    /**
     * 
     * @param {*} againstString cased or uncased string to check against (this is for efficiency, so that we don't have to convertcase internally)
     * @param {*} startCriteria array of starting criteria
     * @param {*} endCriteria array of ending criteria
     * @param {*} casedString cased version of against string, so that the cased input can be returned even if uncased input is used for matching.
     * @returns //{
     *  unmatched_prefix: str, //cased exact substring of againstString which doesn't match the startcriteria
     *  matched_start: str, //cased exact substring of start criteria that was matched
     *  free_content: str, // stuff after a full match of startCriteria but before a partial match of end criteria
     *  matched_end: str, // cased exact substring of end criteria that was matched
     *  unmatched_end: str, //cased exact substring leftover after endcriteria
     * }
     * 
     */
    static doesMatch(againstString, startCriteria, endCriteria, casedString, cancelCriteria) {
        let result = {
            unmatched_prefix: "",
            matched_start: "",
            free_content: casedString,
            uncased_free: againstString,
            matched_end: "",
            unmatched_end: "",
            split: 0,
            criteriaIndex: -1
        };

        // Initial check for start criteria
        for (let s in startCriteria) {
            let start = startCriteria[s];
            let overlap = this.findOverlap(againstString, start); 
            if(overlap >= 0) { 
                if(overlap > 0)
                    result.unmatched_prefix = casedString.substring(0, overlap);
                result.matched_start = casedString.substring(overlap, overlap+start.length);               
                if(result.matched_start.length == start.length) {
                    result.matched_start = '';
                    result.split = -1;
                    result.criteriaIndex = s;
                }
                result.free_content = casedString.substring(overlap+start.length, againstString.length);
                result.uncased_free = againstString.substring(overlap+start.length, againstString.length);
                break;
            } else {
                result.free_content='';
                result.uncased_free='';
                result.unmatched_prefix = casedString; 
            }
        }
        if(result.free_content.length > 0) {
            let against = result.uncased_free;
            for (let e in endCriteria) {
                let end = endCriteria[e];
                let overlap = this.findOverlap(against, end);
                if(overlap >= 0) {    
                    result.matched_end = result.free_content.substring(overlap, overlap+end.length);
                    if(result.matched_end.length == end.length) {
                        result.unmatched_end = result.free_content.substring(overlap+end.length, against.length);
                        result.matched_end = '';  
                        result.split = 1;
                        result.criteriaIndex = e;
                    }
                    result.free_content = result.free_content.substring(0, overlap);
                    result.uncased_free = result.free_content.substring(0, overlap);
                    
                    break;
                }                
            }
            if(endCriteria.length == 0) {
                result.unmatched_end = result.free_content;
            }
        }

        return result;
    }

    static findOverlap(str1, str2) {
        let overlap = str1.indexOf(str2);
        if(overlap >=0 ) return overlap;
        if(str2.indexOf(str1) == 0) return 0;
        for (let i = 0; i < str1.length; i++) {
            if (str2.startsWith(str1.substring(i, str1.length))) {
                overlap = i;
                break;
            }
        }
        return overlap;
    }
}
const PRE_TAG = -2;
const TAG_START_MAYBE = -1;
const TAG_INNER = 0;
const TAG_END_MAYBE = 1;
const POST_TAG = 2;
const NONE = []
class MatchOnTrack {
    
    constructor(start, end) {
        this.state = PRE_TAG;
        this.prevstate = this.state;
        if(Array.isArray(start))
            this.start = start;
        else
            this.start = [start];
        if(Array.isArray(end))
            this.end = end;
        else
            this.end = [end];
        this.reset();
    }

    reset() {
        this.criteriaIndex = -1;
        this.criteria_triggered = null;    
        this.uncased_start = []
        this.uncased_end = [];
        for(let s of this.start) {this.uncased_start.push(s.toLowerCase())};
        for(let s of this.end) {this.uncased_end.push(s.toLowerCase())};
        this.matchedSoFar = '';
        this.uncased_matchedSoFar = '';
        this.state = PRE_TAG;
        this.prevstate = PRE_TAG;
        this.potentialMatch = '';
        this.parsedContent = '';
        this.accumulated = '';
        this.endswith = '';
    }

    /**
     * case0insensitive accumulating match. 
     * returns true if the string maintains the match tracked
     * by this MatchOn, false otherwise.
    */
    buildMatch(newchunk) { 
        if(this.state == POST_TAG && this.prevstate == POST_TAG) {
            this.potentialMatch = '';
            this.parsedContent = '';
            this.sectionwise = '';
            this.endswith = '';
            this.prevstate = PRE_TAG;
            this.state = PRE_TAG;
        }
        let startCriteria = this.state < TAG_INNER ? this.uncased_start : NONE;
        let endCriteria = this.state < POST_TAG ? this.uncased_end : NONE;
        let showsafe = '';
        let showCandidate = '';
        let output = {};
        //if(endCriteria.length + startCriteria.length == 0) this.endswith += newchunk;
        this.potentialMatch += newchunk;
        let tresult = MatchFilter.doesMatch(this.potentialMatch.toLowerCase(), startCriteria, endCriteria, this.potentialMatch, []);
        if(this.state == TAG_INNER || this.state == TAG_END_MAYBE && tresult.split == 0) {
            this.parsedContent += tresult.free_content;
            showCandidate = tresult.free_content;
            output.tagged_text = tresult.free_content;
        }
        if(tresult.split == 1 || tresult.matched_end.length>0 || tresult.unmatched_end.length > 0) {            
            //showCandidate = tresult.unmatched_end;
            if(tresult.unmatched_end.length >0 || tresult.split == 1) {
                this.prevstate = this.state;
                this.state = POST_TAG;
                this.endswith += tresult.unmatched_end;
                this.potentialMatch = tresult.unmatched_end;
                output.tagged_text = tresult.free_content;
                output.base_text = tresult.unmatched_end;
                if(tresult.split == 1) {
                    this.criteria_triggered = endCriteria[tresult.criteriaIndex];
                    this.criteriaIndex = tresult.criteriaIndex;
                }
            } else {
                this.prevstate = this.state;
                this.state = TAG_END_MAYBE;
                this.potentialMatch = tresult.matched_end;
                output.tagged_text = tresult.free_content;
                //this.parsedContent += tresult.free_content;
                //showCandidate = tresult.free_content;
            }
        }
        else if(tresult.free_content.length > 0 || tresult.split == -1) {
            this.prevstate = this.state;
            this.state = TAG_INNER;
            this.potentialMatch = '';
            this.startCriteria = [];
            this.parsedContent += tresult.free_content;
            output.tagged_text = tresult.free_content
            if(tresult.split == -1) {
                this.criteria_triggered = startCriteria[tresult.criteriaIndex];
                this.criteriaIndex = tresult.criteriaIndex;
            }
        } else {
            this.accumulated += tresult.unmatched_prefix;
            output.base_text = tresult.unmatched_prefix
            this.sectionwise += tresult.unmatched_prefix;
            this.potentialMatch = tresult.matched_start;
            if(this.potentialMatch.length > 0) {
                this.prevstate = this.state; 
                this.state = TAG_START_MAYBE;
            }
        }
        if(this.prevstate >= TAG_INNER && this.prevstate <= TAG_END_MAYBE && this.state >= POST_TAG ) {
            showsafe = this.parsedContent;
        } else if(this.state < TAG_START_MAYBE || this.state > TAG_END_MAYBE) {
            showsafe = showCandidate;
        }
        return {prevstate: this.prevstate, state: this.state, 
                criteriaIndex: this.criteriaIndex, 
                criteria_name_triggered: this.criteria_triggered,
                 ...output};
    }
}

/*let mf = new MatchFilter('<meta-search>','</meta-search>');
mf.init();
let runit = async ()=> {
    while (true) {
        let streamgen = await asyncIntGen(100, 1);
        let stream = mf.feed(streamgen, (chunk) => chunk.choices[0]?.delta?.content || "" )
        for await (const chunk of stream) {
            let res = chunk;
            console.log(res);
        }
    }
}

runit();*/