import { Convo } from '../chat_history.js';
import * as prompts from './reasoning_prompts.js';

/**
 * maintains the current state of the assistant as it traverses through the prompt logic.
 */
export class ASST {
    /**
     * @param {Convo} convo_tree the base conversation tree the assistant should work from
     * @param {prompts.PromptCoordinator} prompt_container the prompt coordinator containing the rules for this assistant's generations
     * @param {CallableFunction} on_commit callback triggered when all analysis has concluded and a response has been decided on
     * @param {CallableFunction} on_state_change callback triggered whenever the assistant state changes as a result of some internal logic
     * @param {CallableFunction} on_generate callback triggered any time any autorregressive generation occurs for any reason
     */
    constructor(convo_tree) {
        this.convo_tree = convo_tree;
    }

    replyTo(messageNode) {
        this.replyingTo = messageNode;
        let convo_branch = this.replyingTo.getPathObjs();
        this.prompt_container.begin(convo_branch);      
    }

    init(prompt_container, on_commit, on_state_change, on_generate) {
        this.prompt_container = prompt_container;
        this.on_commit = on_commit;
        this.on_state_change = on_state_change;
        this.on_generate = on_generate;
        this.am_analyzing = false;
        this.am_generating = false; 
        this.stateHints = ['idle'];
    }

    commit(packet) {
        this.setAmAnalyzing(false);
        this.setAmGenerating(false); 
        this.setStateHint('idle');
        if(this.on_commit != null) {
            this.on_commit(packet, this);
        }
    }


    setStateHint(newState) {
        let oldStates = [...this.stateHints];
        this.stateHints = [newState];
        this._on_state_change({
                oldStateHints : oldStates,
                newStateHints : this.stateHints
            })
    }

    addStateHint(newState) {
        let oldStates = [...this.stateHints];
        this._not_idle();
        this.stateHints.append(newState);
        this._on_state_change({
                oldStateHints : oldStates,
                newStateHints : this.stateHints
            });
    }

    _not_idle() {
        if(this.am_analyzing || this.am_generating) {
            let idleIndex = this.stateHints.indexOf('idle');
            if(idleIndex > -1) {
                this.stateHints.slice(idleIndex, 1);
            }
        }
    }

    setAmAnalyzing(state) {
        if(this.am_analyzing != state) {
            this.am_analyzing = state;
            this._not_idle();
            this._on_state_change({changedVal : 'analyzing'}); 
        }
    }

    setAmGenerating(state) {
        if(this.am_analyzing != state) {
            this.am_generating = state;
            this._not_idle();
            this._on_state_change({changedVal : 'generating'});
        }
    }

    _on_state_change(packet) {
        if(this.on_state_change != null) {
            this.on_state_change(packet, this);
        }
    }
    
    _on_generate(packet) {
        if(this.on_generate != null) {
            this.on_generate(packet, this);
        }
    }
    setPromptCoordinator(prompt_coordinator) {
        this.prompt_coordinator = prompt_coordinator;
    }
    
}