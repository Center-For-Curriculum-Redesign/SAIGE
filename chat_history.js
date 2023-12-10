import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export class BoundedRecencyList {
    constructor() {
        this.items = new Map();
    }

    add(item, value) {
        // Remove item if it exists to update its position
        if (this.items.has(item)) {
            this.items.delete(item);
        }
        this.items.set(item, value);
    }

    getItems() {
        return Array.from(this.items.keys());
    }
}

export const recentlyUsed = new BoundedRecencyList();

export const knownFormats = {
    'inline_quote': {
        'system': '',
        'role_strings': {
            'user': '\nUserMessage: ',
            'assistant': '\nAssistantMessage: '
        }
    }
};

export class Formatter {
    constructor(tokenizer = null) {
        this.tokenizer = tokenizer;
    }

    stringCompletionFormat(messageNodes, systemPrompt = null, addGenerationPrompt = true) {
        let formatted = '';
        for (let m of messageNodes) {
            if(m.getAuthor() == null && m.getContent() == null) {
                continue; //empty root node
            }
            formatted += `\n${knownFormats['inline_quote']['role_strings'][m.getAuthor()]}${m.getContent()}\n`;
        }
        
        if (systemPrompt) {
            formatted += systemPrompt;
        }
        return formatted;
    }

    roleChatFormat(messageNodes, systemPrompt = null, addGenerationPrompt = true) {
        let messageDictList = [];
        let lastRole = 'system';
        if (systemPrompt !== null) {
            messageDictList.push({role: 'system', content: systemPrompt});
        }
        for (let i = 0; i < messageNodes.length; i++) {
            let m = messageNodes[i];
            if(m.getAuthor() == null && m.getContent() == null) {
                continue; //empty root node
            }
            if (lastRole === m.getAuthor()) {
                messageDictList[i].content += `\n---\n ${m.getContent()}`;
            } else {
                messageDictList.push({
                    role: m.getAuthor(), 
                    content: m.getContent()
                });
            }
            lastRole = m.getAuthor();
        }
        return messageDictList;
    }
}

export class MessageHistories {
    constructor(author, textContent, conversationId, conversation_node) {
        this.nodeId = null;
        this.messagenodeUuid = uuidv4();
        this.conversationId = conversationId;
        this.conversation_node = conversation_node;
        this.children = {};
        this.messageMap = {};
        this.textContent = textContent;
        this.author = author;
        this.parentNode = null;
        this.state = (this.author == 'user') ? 'committed' : 'init';
        if(conversation_node) this.conversation_node?.register(this);
    }

    getNode(subnodeString, fullSequence = null) {
        return this.historyAsList(subnodeString, fullSequence).pop();
    }

    getAuthor() {
        return this.author;
    }

    setState(newState) {
        this.state = newState;
    }
    getState() {
        this.state;
    }

    getContent() {
        return this.textContent;
    }

    setContent(textCont) {
        this.textContent = textCont;
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
        if (this.parentNode != null) {
            return `${this.parentNode.getPath()}#${this.getNodeId()}`;
        } else {
            return this.getNodeId();
        }
    }
    /**returns the actual nodes from the root to this obj*/
    getPathObjs() {
        if(this.parentNode != null) {
            return [...this.parentNode.getPathObjs(), this];
        } else return [this];
    }

    /**
     * notifies parent nodes that this is the child they point to by default.
     */
    setPath(activeChildId) {
        this.activeDescendants = activeChildId;
        if(this.parentNode != null)
            this.parentNode.setPath(this.getNodeId());        
    }

    /*doesn't actually modify the parent, but does set the parameters of this messagehistory node as if the paren
    adopted it*/
    setIntendedParentNode(parentNode) {
        this.setNodeId(`${Object.keys(parentNode.children).length}`);
        this.parentNode = parentNode;
        this.parentNodeUuid = parentNode.messagenodeUuid;
        this.parentNodeId = this.parentNode.nodeId;
        this.conversationId = this.parentNode.conversationId;
        this.conversation_node = this.parentNode.conversation_node;
        if(this.conversation_node) 
            this.conversation_node?.register(this);
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

    addChildReply(newMessageNode) {
        newMessageNode.setNodeId(`${Object.keys(this.children).length}`);
        this.children[newMessageNode.getNodeId()] = newMessageNode;
        newMessageNode.setParentNode(this);
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
                throw new Error(`node_entry ${fullSequence} not found`);
            } else {
                return [this];
            }
        } else if (splitted.length > 1) {
            let nextDesc = splitted[1].split("#", 2)[0];            
            if (nextDesc in this.children) {
                this.activeDescendants = nextDesc;
                return [this].concat(this.children[nextDesc].historyAsList(splitted[1], fullSequence));
            } else {
                return [this];
            }
        }
        throw new Error(`node_entry ${fullSequence} not found`);
    }

    // Converts the current object and its children to a JSON object
    toJSON() {
        let childrenJSON = {};
        for (let key in this.children) {
            childrenJSON[key] = this.children[key].toJSON();
        }

        return {
            nodeId: this.nodeId,
            messagenodeUuid: this.messagenodeUuid,
            conversationId: this.conversationId,
            children: childrenJSON,
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
        let messageHistory = new MessageHistories(json.author, json.textContent, conversation_id, conversation_node);
        messageHistory.nodeId = json.nodeId;
        messageHistory.messagenodeUuid = json.messagenodeUuid;
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

        return messageHistory;
    }
}

export class Convo {
    constructor(conversationId, systemStartText, startSequence = null, startKvCache = null, formatter = null, tokenizer = null) {
        this.messageMap = {};
        this.messages = new MessageHistories(null, null, conversationId, this);
        this.messages.setNodeId('root');
        this.activePath = null;
        this.systemPrompt = systemStartText;
        this.formatter = formatter;
        this.conversationId = conversationId;
        // Additional initialization if needed
    }

    getNode(messagePath) {
        if(messagePath == null) return this.messages;
        let headlesssPath = messagePath.split("root#",2)
        return this.messages.getNode(headlesssPath.pop());
    }

    addReplyToUuid(messagenodeUuid, author = "user", textContent = null) {
        let addTo = this.messageMap[messagenodeUuid]
        let new_node = new MessageHistories(author, textContent, this.conversationId, this);
        addTo.addChildReply(new_node);
        this.activePath = new_node.getPath();
        new_node.setPath();
        return new_node;
    }

    addReply(messagePath = null, author = "user", textContent = null) {
        let new_node = new MessageHistories(author, textContent, this.conversationId, this);
        if (this.messages === null) {
            this.messages = new_node;
            new_node.setNodeId("0");
        } else {
            if (messagePath === null) {
                messagePath = this.activePath;
            }
            this.getNode(messagePath).addChildReply(new_node);
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
            messagenodeUuid : this.conversationId
        };
    }

    static fromJSON(json) {
        let newConvo = new Convo(json.conversationId, json.systemPrompt);
        newConvo.activePath = json.activePath;
        newConvo.messages = MessageHistories.fromJSON(json.messages, null, newConvo.conversationId, newConvo);
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
