import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { type } from 'os';

export const getType = (obj) => obj?.constructor?.name || Object.prototype.toString.call(obj);

export class Convo {
    constructor(conversationId, systemStartText, startSequence = null, startKvCache = null, formatter = null, tokenizer = null) {
        this.messageMap = {};        
        
        this.activePath = null;
        this.systemPrompt = systemStartText;
        this.formatter = formatter;
        this.conversationId = conversationId;
        // Additional initialization if needed
    }

    initRoot(rootNode = null) {
        if(this.messages != null) {
            throw Error("Conversation already has a root");
        }
        if(rootNode == null) {
            this.messages = new MessageHistories(null, null, this.conversationId, this);
            this.messages.setNodeId('root');
        } else {
            this.messages = rootNode;
        }
        this.messageMap[this.messages.messagenodeUuid] = this.messages;
    }

    getNode(messagePath) {
        if(messagePath == null) return this.messages;
        let headlesssPath = messagePath.split("root#",2)
        return this.messages.getNode(headlesssPath.pop());
    }

    addReplyToUuid(messagenodeUuid, author = "user", textContent = null, notify = false) {
        let addTo = this.messageMap[messagenodeUuid]
        let new_node = new MessageHistories(author, textContent, this.conversationId, this);
        addTo.addChildReply(new_node);
        this.activePath = new_node.getPath();
        new_node.setPath();
        if(notify) {
            this._on_structure_change('node_added', new_node);
        }
        return new_node;
    }

    getNodeByUuid(uuid) {
        return this.messageMap[uuid];
    }

    addReply(messagePath = null, author = "user", textContent = null, notify = false) {
        let new_node = new MessageHistories(author, textContent, this.conversationId, this);
        if (this.messages === null) {
            this.messages = new_node;
            new_node.setNodeId("0");
            if(notify) {
                this._on_structure_change('node_added', new_node);
            }
        } else {
            if (messagePath === null) {
                messagePath = this.activePath;
            }
            this.getNode(messagePath).addChildReply(new_node, notify = false);
        }
        this.activePath = new_node.getPath();
        new_node.setPath();
        return new_node;
    }

    roleFormatMessageHistory(messagePath = null, formatter = null, addGenerationPrompt = false) {
        let messageList = this.messages.historyAsList(messagePath);
        let messageDictList = this.formatter.roleChatFormat(messageList, this.systemPrompt, addGenerationPrompt);
        return messageDictList;
    }

    stringFormatMessageHistory(messagePath = null, formatter = null, syspromptOverride = null, addGenerationPrompt = false) {
        let messageList = this.messages.historyAsList(messagePath);
        let sysprompt = syspromptOverride === null ? this.systemPrompt : syspromptOverride;
        let formatted = this.formatter.stringCompletionFormat(messageList, sysprompt, addGenerationPrompt);
        return formatted;
    }
    
    /**
     * internal wrapper for user definable on_textContent_change.
     * you can use this to register callbacks whenever something modifies the internal textContent of a messageHistory node.
     * will emit an object of the form 
     * 
     * {
     * type: 'content_change',
     * event_name: 'content_change',
     * nodeInfo: //json object of the messagehistory node
     * }
     */
    _on_textContent_change(nodeInfo) {
        if(this.on_textContent_change) {
            let nodeInfo_uw = nodeInfo
            if(nodeInfo.nodeInfo != null) {
                nodeInfo_uw = nodeInfo.nodeInfo;
            }
            nodeInfo_uw.conversationId = this.conversationId;        
            this.on_textContent_change({
                type: 'content_change',
                nodeInfo: nodeInfo_uw
            });
        }
    }

    /**
     * internal wrapper for user definable on_structure_change.
     * you can use this to register callbacks for whenever a descendant node has been created or removed
     * payload will looks like 
     * {
     *      type: 'node_added' || 'node_removed',
     *      event_name: will have same value as `type`,
     *      changeType: will have same value as `type`,
     *      nodeInfo: {//JSON of the MessageHistoryNode that was added or removed.
     *  }
     * The redundancy in naming is so you can be less careful with how you wrap the payload when broadcasting. 
     * Please be as irresponsible as possible.
     */
    _on_structure_change(changeType, nodeInfo) {        
        if(this.on_structure_change) {
            let changeType_uw = changeType;
            let nodeInfo_uw = nodeInfo
            if(nodeInfo.changeType != null && nodeInfo.nodeInfo != null) {
                changeType_uw = nodeInfo.changeType;
                nodeInfo_uw = nodeInfo.nodeInfo;            
            }
            nodeInfo_uw.conversationId = this.conversationId;
            if(changeType != 'node_added' && changeType != 'node_removed') {
                throw Error("structure changeType must be one of `node_added` or `node_removed`");
            }
            let infoObj = {
                type: changeType_uw,
                event_name: changeType_uw,
                changeType : changeType_uw,
                nodeInfo : nodeInfo_uw.toJSON()
            }
            this.on_structure_change(infoObj);
        }
    }

    /**
     * internal wrapper for user definable on_state_change.
     * you can use this to register callbacks for whenever a descendant node has had it's state attribute changed, 
     * (common attributes include:
     *  'init' -- set when a node is still being created, usually before having all attributes necessary for saving, 
     *  'committed' -- set when the contents of a node are no longer intended to be modiied, implying the node can be saved in the full structure.
     *  'hidden' -- set when a node should be collapsed or hidden from the user.)
     * {
     *      event_name: 'node_state_changed',
     *      previous: the previous state,
     *      nodeInfo: {//JSON of the MessageHistoryNode that was added or removed.
     *  }
     * The redundancy in naming is so you can be less careful with how you wrap the payload when broadcasting. 
     * Please be as irresponsible as possible.
     * @param {*} nodeInfo 
     * @param {*} previous_state 
     */
    _on_state_change(nodeInfo, previous_state) {        
        if(this.on_state_change  != null) {
            let nodeInfo_uw = nodeInfo
            if(nodeInfo.nodeInfo != null) {
                nodeInfo_uw = nodeInfo.nodeInfo;
            }
            nodeInfo_uw.conversationId = this.conversationId; 
            let infoObj = {
                event_name: 'node_state_changed',
                prev: previous_state,
                previous: previous_state,
                previous_state: previous_state,
                prev_state: previous_state,
                nodeInfo : nodeInfo_uw.toJSON()
            }
            this.on_content_change(infoObj);
        }
    }

    /**
     * adds a messageHistory node to the internal map for easy lookup.
     * @param {MessageHistories} messageNode 
     */
    register(messageNode) {
        this.messageMap[messageNode.messagenodeUuid] = messageNode;
    }

    toJSON(asFiltered=true) {
        let showPrompt =  asFiltered == true ? null : this.systemPrompt;
        return {
            messages : this.messages.toJSON(),
            activePath : this.activePath,  
            systemPrompt : showPrompt,          
            conversationId : this.conversationId,
            messagenodeUuid : this.conversationId,
            user_id: this.user_id
        };
    }

    static fromJSON(json) {
        let newConvo = new Convo(json.conversationId, json.systemPrompt);
        newConvo.user_id = json.user_id;
        newConvo.activePath = json.activePath;
        newConvo.initRoot(MessageHistories.fromJSON(json.messages, null, newConvo.conversationId, newConvo));
        return newConvo;
    }

    async save(fs, filePath) {
        await fs.writeFile(filePath, JSON.stringify(this.toJSON(false)), 'utf8');
    }

    static async load(fs, filePath) {
        try { 
            await fs.access(filePath, fs.constants.F_OK); // Check if file exists
            const data = await fs.readFile(filePath, 'utf8'); // Read file contents
            const asj = JSON.parse(data);
            return Convo.fromJSON(asj);
        } catch(e) {
            return null;
        }
    }
}


export class MessageHistories {
    constructor(author, textContent, conversationId, conversation_node , messagenodeUuid = null) {
        this.nodeId = null;
        this.messagenodeUuid = messagenodeUuid || uuidv4();
        this.conversationId = conversationId;
        this.conversation_node = conversation_node;
        this.children = {};
        this.thoughts = {};
        this.thoughtsByUuid = {};
        this.textContent = textContent;
        this.author = author;
        this.parentNode = null;
        this.state = (this.author == 'user' || this.author == 'system') ? 'committed' : 'init';
        if(conversation_node) this.conversation_node?.register(this);
    }

    getNode(subnodeString, fullSequence = null) {
        return this.historyAsList(subnodeString, fullSequence).pop();
    }

    getAuthor() {
        return this.author;
    }

    setState(newState, notify = false) {
        this.state = newState;
    }
    getState() {
        this.state;
    }

    getContent() {
        return this.textContent;
    }

    /**creates a new thought node (same as a messagehistory object, just not kept in the childrens map) 
     * and adds it to this messagehistories thought map.
    */
    newThought(author, notify = false) {
        let newThought = new ThoughtHistories(author, '', this.conversationId, this.conversation_node);
        this.thoughts[Object.keys(this.thoughts).length] = newThought;
        this.thoughtsByUuid[newThought.messagenodeUuid] = newThought;
        newThought.setParentNode(this);
        newThought.thoughtType = "subThought";
        if(notify && this.conversation_node != null) {
            this.conversation_node._on_structure_change('node_added', newThought);
        }
        return newThought;
    }

    /**adds a provided thought node (same as a messagehistory object, just not kept in the childrens map) 
     * to this messagehistories thought map.
    */
    addThought(newThoughtNode, notify = false) {
        let hereAlready = false;
        for(let [k,v] in Object.entries(this.children)) {
            if(v == newMessageNode){
                hereAlready = true;
            }
            break;
        }
        if(hereAlready == false) {
            newThoughtNode.setNodeId(`${Object.keys(this.thoughts).length}`);
            this.thoughts[newThoughtNode.getNodeId()] = newThoughtNode;
        }
        this.thoughtsByUuid[newThoughtNode.messagenodeUuid] = newThoughtNode;
        newThoughtNode.setParentNode(this);
        newThoughtNode.thoughtType = "subThought";
        if(notify && this.conversation_node != null) {
            this.conversation_node._on_structure_change('node_added', newThoughtNode);
        }
        return newThoughtNode;
    }

    /**
     * overwrites the current textcontent
     * @param {string} textCont 
     * @param {boolean} notify whether to trigger the event notification registered on this messagehistory object (if none has been set, will check the conversation_id's notifier, before giving up)
     */
    setContent(textCont, notify=false) {
        let oldContent = this.textContent
        this.textContent = textCont;
        if(notify) {
            this._on_content_change(oldContent, this.textContent);
        }
    }

    /**
     * appends to the existing text content
     * @param {string} textCont 
     * @param {boolean} notify whether to trigger the event notification registered on this messagehistory object (if none has been set, will check the conversation_id's notifier, before giving up)
     */
    appendContent(textCont, notify=false) {
        //let oldContent = this.textContent
        this.textContent += textCont;
        if(notify) {
            this._on_content_change(null, textCont);
            //console.log(textCont);
        }
    }

    /**
     * 
     * @param {string} prevContent //leaving this value null will cause the notiication to impicitly treat the change as appending instead of replacing
     * @param {string} newContent 
     */
    _on_content_change(prevContent, newContent) {
        let info
        if(prevContent != null) {
            info = this.toJSON(); 
            info['prev_textContent'] = prevContent;
        } else {
			info = {
                messagenodeUuid : this.messagenodeUuid,
                conversationId : this.conversationId,
                deltaChunk: newContent,
                nodeType: getType(this),
                parentNodeUuid: this.parentNodeUuid 
            }
        }
        if(this.on_content_change == null && this.conversation_node != null) {            
            this.conversation_node._on_textContent_change(info);
        } else if(this.on_content_change != null) {
            this.on_content_change(info);
        }
    }

    setNodeId(nodeId) {
        this.nodeId = nodeId;
    }

    getNodeId() {
        return this.nodeId;
    }

    getParentNode() {
        return this.parentNode;
    }

    /**returns the path string to this node */
    getPath() {
        if (this.parentNode != null && getType(this.parentNode) == getType(this)) {
            return `${this.parentNode.getPath()}#${this.getNodeId()}`;
        } else {
            return this.getNodeId();
        }
    }
    /**returns the actual nodes from the root to this obj*/
    getPathObjs(sameTypeOnly = false) {
        if(sameTypeOnly && getType(this.parentNode) != getType(this)) 
            return [this]
        if(this.parentNode != null) {
            return [...this.parentNode.getPathObjs(), this];
        } else return [this];
    }

    /**
     * notifies parent nodes that this is the child they point to by default.
     */
    setPath(activeChildId) {
        this.activeDescendants = activeChildId;
        if(this.parentNode != null && getType(this.parentNode) == getType(this))
            this.parentNode.setPath(this.getNodeId());        
    }


    /**
     * doesn't actually modify the parent, but does set the parameters of this messagehistory node as if the paren adopted it
     * @param {MessageHistories} parentNode 
     * @param {boolean} notify whether to broadcast an event purporting that this node has been added to the conversation tree.
     */
    setIntendedParentNode(parentNode, notify = false) {
        this.setNodeId(`${Object.keys(parentNode.children).length}`);
        this.parentNode = parentNode;
        this.parentNodeUuid = parentNode.messagenodeUuid;
        this.parentNodeId = this.parentNode.nodeId;
        this.conversationId = this.parentNode.conversationId;
        this.conversation_node = this.parentNode.conversation_node;
        if(this.conversation_node) {
            this.conversation_node?.register(this);
            if(notify) {
                this.conversation_node._on_structure_change('node_added', this);
            }
        }
    }

    setParentNode(parentNode) {
        this.parentNode = parentNode;
        this.parentNodeUuid = parentNode.messagenodeUuid;
        this.parentNodeId = this.parentNode.nodeId;
        this.conversationId = this.parentNode.conversationId;
        this.conversation_node = this.parentNode.conversation_node;
        if(this.conversation_node)             
            this.conversation_node?.register(this);
    }

    addChildReply(newMessageNode, notify) {
        if(getType(newMessageNode) == getType(this)) {
            let hereAlready = false;
            for(let [k,v] in Object.entries(this.children)) {
                if(v == newMessageNode){
                    hereAlready = true;
                }
                break;
            }
            if(hereAlready == false) {
                newMessageNode.setNodeId(`${Object.keys(this.children).length}`);
                this.children[newMessageNode.getNodeId()] = newMessageNode;
            }
            newMessageNode.setParentNode(this);
            if(notify && this.conversation_node != null) {
                this.conversation_node._on_structure_change('node_added', newMessageNode);
            }
        }
        return newMessageNode;
    }

    historyAsList(subnodeString = null, fullSequence = null) {
        if (subnodeString === null) {
            return [];
        }
        if (fullSequence === null) {
            fullSequence = subnodeString;
        }
        let splitted = subnodeString.split("#", 2);
        let toGet = splitted[0];
        if (splitted.length === 1) {
            if (toGet !== this.nodeId) {
                throw new Error(`node_entry ${fullSequence} not found: When attempting to get: ${toGet} in ${this.nodeId} with subnodestring ${subnodeString}`);
            } else {
                return [this];
            }
        } else if (splitted.length > 1) {
            let nextDesc = splitted[1].split("#", 2)[0];            
            if (nextDesc in this.children) {
                //this.activeDescendants = nextDesc;
                return [this].concat(this.children[nextDesc].historyAsList(splitted[1], fullSequence));
            } else {
                return [this];
            }
        }
        throw new Error(`node_entry ${fullSequence} not found: ` + fullSequence);
    }

    // Converts the current object and its children to a JSON object
    toJSON() {
        let childrenJSON = {};
        let thoughtJSON = {};
        for (let key in this.children) {
            childrenJSON[key] = this.children[key].toJSON();
        }

        for (let key in this.thoughts) {
            thoughtJSON[key] = this.thoughts[key].toJSON();
        }

        return {
            nodeType : getType(this),
            nodeId: this.nodeId,
            messagenodeUuid: this.messagenodeUuid,
            conversationId: this.conversationId,
            children: childrenJSON,
            thoughts: thoughtJSON,
            activeDescendants : this.activeDescendants,
            textContent: this.textContent,
            author: this.author,
            state: this.state,
            parentNodeId: this.getParentNode()?.getNodeId(),
            parentNodeUuid: this.getParentNode()?.messagenodeUuid
            // parentNode is omitted to avoid circular references
        };
    }

    // Static method to create a MessageHistories object from a JSON object
    static fromJSON(json, parentNode = null, conversation_id, conversation_node) {
        let messageHistory = new MessageHistories(json.author, json.textContent, conversation_id, conversation_node, json.messagenodeUuid);
        messageHistory.activeDescendants = json.activeDescendants;
        messageHistory.nodeId = json.nodeId;
        messageHistory.parentNode = parentNode;
        if(parentNode != null)
            messageHistory.parentNodeUuid = parentNode.messagenodeUuid;
        messageHistory.conversationId = json.conversationId;
        if(conversation_node) { 
            conversation_node.register(messageHistory.conversation_node)
        }
        messageHistory.state = json.state;

        for (let key in json.children) {
            messageHistory.addChildReply(MessageHistories.fromJSON(json.children[key], messageHistory, conversation_id, conversation_node));
        }
        for (let key in json.thoughts) {
            messageHistory.addThought(ThoughtHistories.fromJSON(json.thoughts[key], messageHistory, conversation_id, conversation_node));
        }

        return messageHistory;
    }
}

export class ThoughtHistories extends MessageHistories {
    constructor(author, textContent, conversationId, conversation_node , messagenodeUuid = null, thoughtTitle) {
        super(author, textContent, conversationId, conversation_node , messagenodeUuid = null);
        this.thoughtTitle = thoughtTitle;
    }

    setThoughtTitle(thoughtTitle) {
        this.thoughtTitle = thoughtTitle;
    }

    static fromJSON(json, parentNode = null, conversation_id, conversation_node) {
        let messageHistory = new ThoughtHistories(json.author, json.textContent, conversation_id, conversation_node, json.messagenodeUuid);
        messageHistory.nodeId = json.nodeId;
        messageHistory.parentNode = parentNode;
        messageHistory.thoughtType = json.thoughtType;
        if(parentNode != null)
            messageHistory.parentNodeUuid = parentNode.messagenodeUuid;
        messageHistory.conversationId = json.conversationId;
        if(conversation_node) { 
            conversation_node.register(messageHistory.conversation_node)
        }
        messageHistory.state = json.state;

        for (let key in json.children) {
            messageHistory.addChildReply(ThoughtHistories.fromJSON(json.children[key], messageHistory, conversation_id, conversation_node));
        }
        for (let key in json.thoughts) {
            messageHistory.addThought(ThoughtHistories.fromJSON(json.thoughts[key], messageHistory, conversation_id, conversation_node));
        }

        return messageHistory;
    }

    toJSON() {
        let supJ = super.toJSON();
        supJ['thoughtType'] = this.thoughtType;
        supJ['thoughtTitle'] = this.thoughtTitle;
        return supJ;
    }

    addChildReply(newMessageNode, notify=false) {
        newMessageNode.thoughtType = "thoughtReply"; 
        return super.addChildReply(newMessageNode);
    }

    /**returns the closest ancestor of this node which is of type MessageHistory */
    getMessageParent() {
        if(this.parentNode == null) {
            throw Error("This thought has no thinker");
        }
        if(getType(this.parentNode) == 'MessageHistories') {
            return this.parentNode;
        } else {
            return this.parentNode.getMessageParent();
        }
    }
}


