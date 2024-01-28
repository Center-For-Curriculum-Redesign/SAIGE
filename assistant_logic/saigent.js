import { Convo } from '../chat_history.js';
import * as prompts from './reasoning_prompts.js';

/**
 * maintains the current state of the assistant as it traverses through the prompt logic.
 */
export class ASST {
    /**
     * @param {Convo} convo_tree the base conversation tree the assistant should work from
     * @param {prompts.PromptCoordinator} prompt_coordinator the prompt coordinator containing the rules for this assistant's generations
     * @param {CallableFunction} on_commit callback triggered when all analysis has concluded and a response has been decided on
     * @param {CallableFunction} on_state_change callback triggered whenever the assistant state changes as a result of some internal logic
     * @param {CallableFunction} on_generate callback triggered any time any autorregressive generation occurs for any reason
     */
    constructor(convo_tree) {
        this.convo_tree = convo_tree;
    }

    replyInto(messageNode) {
        this.replyingInto = messageNode;
        let convo_branch = this.replyingInto.getPathObjs();
        this.prompt_coordinator.begin(convo_branch);      
    }

    init(prompt_coordinator, on_commit, on_state_change, on_generate) {
        this.prompt_coordinator = prompt_coordinator;
        this.on_commit = on_commit;
        this.on_state_change = on_state_change;
        this.on_generate = on_generate;
        this.am_analyzing = false;
        this.am_generating = false; 
        this.stateHints = ['idle'];
    }

    /**TODO: implement
    cancelGeneration() {
        this.setAmGenerating(false)
        this.setAmAnalyzing(false)
    } */

    cancelRequest() {
        if(this.replyingInto != null) {
            this.commit(this.replyingInto.textContent, this.replyingInto)
            this.ban_updates = this.replyingInto;
        }
    }

    commit(packet, throughNode = this.replyingInto) {
        this.setAmAnalyzing(false, throughNode);
        this.setAmGenerating(false, throughNode); 
        this.setStateHint('idle', throughNode);
        if(this.on_commit != null) {
            this.on_commit(packet, this, throughNode);
        }
        
    }


    setStateHint(newState, throughNode = this.replyingInto) {
        let oldStates = [...this.stateHints];
        this.stateHints = [newState];
        if(throughNode == this.ban_updates) {
            return;
        }
        this._on_state_change({
                oldStateHints : oldStates,
                newStateHints : this.stateHints
            }, throughNode)
    }

    addStateHint(newState, throughNode = this.replyingInto) {
        let oldStates = [...this.stateHints];
        this._not_idle();
        this.stateHints.append(newState);
        if(throughNode == this.ban_updates) {
            return;
        }
        this._on_state_change({
                oldStateHints : oldStates,
                newStateHints : this.stateHints
            }, throughNode);
    }

    _not_idle() {
        if(this.am_analyzing || this.am_generating) {
            let idleIndex = this.stateHints.indexOf('idle');
            if(idleIndex > -1) {
                this.stateHints.slice(idleIndex, 1);
            }
        }
    }

    setAmAnalyzing(state, throughNode = this.replyingInto) {
        if(throughNode == this.ban_updates) {
            return;
        }
        if(this.am_analyzing != state) {
            this.am_analyzing = state;
            this._not_idle();
            this._on_state_change({changedVal : 'analyzing'}, throughNode); 
        }
    }

    setAmGenerating(state, throughNode = this.replyingInto) {
        if(throughNode == this.ban_updates) {
            return;
        }
        if(this.am_analyzing != state) {
            this.am_generating = state;
            this._not_idle();
            this._on_state_change({changedVal : 'generating'}, throughNode);
        }
    }

    _on_state_change(packet, throughNode = this.replyingInto) {
        if(throughNode == this.ban_updates) {
            return;
        }
        if(this.on_state_change != null) {
            this.on_state_change(packet, this, throughNode);
        }
    }
    
    _on_generate(packet, throughNode = this.replyingInto) {
        if(throughNode == this.ban_updates) {
            return;
        }
        if(this.on_generate != null) {
            this.on_generate(packet, this, throughNode);
        }
    }
    setPromptCoordinator(prompt_coordinator) {
        this.prompt_coordinator = prompt_coordinator;
    }
    
}