const usertext_template = document.getElementById('usertext-versionTemplate').content.querySelector(".usertext-version-area");
const assttext_template = document.getElementById('asst-versionTemplate').content.querySelector(".asst-version-area");
const thoughttext_template = document.getElementById('thought-versionTemplate').content.querySelector(".thought-node");
const system_version_template = document.getElementById('versionTemplate').content.querySelector(".version-area");
const getType = (obj) => obj?.constructor?.name || Object.prototype.toString.call(obj);


function editMessage(button) {
    const wrapper = button.closest(".self-content");
    showElem(wrapper.querySelector(".edit-container"));
    hideElem(wrapper.querySelector(".submitted-text-container"));
}
function cancelEdit(button) {
    const wrapper = button.closest(".self-content");
    hideElem(wrapper.querySelector(".edit-container"));
    showElem(wrapper.querySelector(".submitted-text-container"));
}

function cancelRequest(button) {
    const wrapper = button.closest(".self-content");
    const messageDomnode = wrapper.closest(".message-node");    
    let msgObj = messageDomnode.asObj;
    let activeReply = {
        replyingTo: msgObj.parentNode.messagenodeUuid,
        conversationId: convoTree.conversationId
    }
    const result = xRq(activeReply, default_endpoint+'/cancel_request');
}

async function altReply(button) {
    const wrapper = button.closest(".self-content");
    const editContainer = button.closest(".edit-container");    
    const submittedcont = wrapper.querySelector(".submitted-text-container")
    const messageDomnode = editContainer.closest(".message-node");    
    const textarea = editContainer.querySelector(".input-text-area");
    let msgObj = messageDomnode.asObj;
    //const pathTo = getPathTo(msgObj.parentNode.messagenodeUuid);
    let replyInfo = {
        replyingTo: msgObj.parentNode.messagenodeUuid,
        conversationId: convoTree.conversationId,
        withContent: textarea.value,
        asAuthor: 'user'
    }
    const result = xRq(replyInfo, default_endpoint+'/user_reply');
    //hydrateUserMessageNode(result);
    hideElem(editContainer);
    showElem(submittedcont);
}

async function assistantRegen(button) {
    const messageDomnode = button.closest(".message-node");
    priorResponseNode = messageDomnode
    let msgObj = messageDomnode.asObj;
    let parentNode = msgObj.parentNode;
    let replyInfo = {
        replyingTo: parentNode.messagenodeUuid,
        conversationId: convoTree.conversationId,
        asAuthor: 'assistant'
    }

    const result = await xRq(replyInfo, default_endpoint+'/assistant_reply');
}


async function newReply(button) {
    let inputField = button.closest(".user-inputs").querySelector(".general-input-text");
    //let histlist = historyAsList(convoTree.activePath, convoTree.activePath, rootNode);
    let activeList = activeAsList(convoTree.messages); 
    let replyTo  = activeList.pop().messagenodeUuid;
    let replyInfo = {
        conversationId: convoTree.conversationId,
        withContent: inputField.value,
        asAuthor: 'user',
        replyingTo: replyTo
    }
    const result = await xRq(replyInfo, default_endpoint+'/user_reply');
}

const default_endpoint = '/chat_commands';
/*sends and responds to the default endpoint with json POST [body*/
async function xRq(json, url=default_endpoint) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(json)
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
}

function toggleThoughts(button) {
    let parentContainer = button.closest(".self-content");
    let thoughtsContainer = parentContainer.querySelector('.thought-text-area');
    if(thoughtsContainer.classList.contains('hidden'))
        showElem(thoughtsContainer);
    else
        hideElem(thoughtsContainer);
}

function showPrev(button) {
    toggleMessageNode(button, -1);
}

function showNext(button) {
    toggleMessageNode(button, 1);
}

function hideElem(elem) {
    elem.classList.add("hidden");
}
function showElem(elem) {
    elem.classList.remove("hidden");
}

//cycles through the active children of this messagenode
function toggleMessageNode(button, direction) {
    const parDomElem = button.closest('.message-node');
    //const vselectors = currentMessageNode.closest('.version-selectors');
    
    let parObj = parDomElem.asObj;
    let asObj = parObj.children[parObj.activeDescendants];
    const currentMessageNode = asObj.domElem;
    const vselectors = parObj.domElem.querySelector('.version-selectors');
    let siblings = Object.values(parObj.children);
    let currIndex = Number(asObj.nodeId);
    let newIndex = (siblings.length + currIndex + direction) % siblings.length;
    let newMessageNode = siblings[newIndex];
    parObj.activeDescendant = newIndex;
    hideElem(currentMessageNode);
    showElem(newMessageNode.domElem);
    let activeList = activeAsList(convoTree.messages)
    convoTree.activePath = getPathTo(activeList[activeList.length-1]);
    showExclusive(newMessageNode);
    let currindicator = vselectors.querySelector(".current-index");
    currindicator.textContent = (Number(newMessageNode.nodeId)+1)+'';
}

/**
 * like historyAsList, but returns the list as returned by the activeDescendant parameter of messageHistoryObjects.
 */
function activeAsList(subNode) {
    if(subNode?.children) {
        if(Object.keys(subNode.children).length > 0) {
            if(subNode.activeDescendants == null) {
                subNode.activeDescendants = Object.keys(subNode.children)[0];
            }
            nextDesc = subNode.children[subNode.activeDescendants];
            return [subNode].concat(activeAsList(nextDesc));
        } else {
            return [subNode]
        }
    }
}

function historyAsList(subnodeString = null, fullSequence = null, currentNode = null) {
    if (subnodeString === null) {
        return [];
    }
    if (fullSequence === null) {
        fullSequence = subnodeString;
    }
    let splitted = subnodeString.split("#", 2);
    let toGet = splitted[0];
    if (splitted.length === 1) {
        if (toGet !== currentNode.nodeId) {
            throw new Error(`node_entry ${fullSequence} not found`);
        } else {
            return [currentNode];
        }
    } else if (splitted.length > 1) {
        let nextDesc = splitted[1].split("#", 2)[0];
        if (nextDesc in currentNode.children) {
            return [currentNode].concat(historyAsList(splitted[1], fullSequence, currentNode.children[nextDesc]));
        }
    }
    throw new Error(`node_entry ${fullSequence} not found`);
}

/**adds backward links to parent nodes in the convo tree for easier traversal */
function funneltree(messagetree) {    
    for(let key in messagetree?.children) { 
        let child = messagetree.children[key];
        child.parentNode = messagetree;
        funneltree(child);
    };
}

//returns a traversal path which would access the given message node
function getPathTo(messageNode) {
    if( messageNode == null)
        return null;
    if (messageNode?.parentNode?.children != null) {
        return `${getPathTo(messageNode.parentNode)}#${messageNode.nodeId}`;
    } else {
        return messageNode.nodeId;
    }
}


function hydrateBaseMessageContainer(messageObj, empty) {
    messageObj.domElem = empty;
    empty.asObj = messageObj
    let parDom = null; 
    empty.responseDomElem = empty.querySelector(".response-container");
    if(messageObj.thoughts != null) {
        empty.subThoughtDomElem = empty.querySelector(".thought-text-area");
    }
    if(messageObj.parentNode != null) {
        parDom = messageObj.parentNode.domElem;        
    } else {
        parDom = convoTree.domElem;
        messageObj.parentNode = convoTree;
    }
    parDom.responseDomElem.appendChild(empty); 
    if(messageObj?.parentNode.activeDescendants == messageObj?.nodeId) 
        showElem(empty);
}

function hydrateAssistantMessageContainer(messageObj, empty) {    
    hydrateBaseMessageContainer(messageObj, empty);
    let submittedText = empty.querySelector(".completed-text-area");
    submittedText.textContent = messageObj.textContent;      
    let inProgressText = empty.querySelector(".in-progress-response-text-area");
    inProgressText.textContent = messageObj.textContent;
}

function hydrateUserMessageContainer(messageObj, empty) {
    hydrateBaseMessageContainer(messageObj, empty);
    let submittedText = empty.querySelector(".submitted-text-area");
    submittedText.textContent = messageObj.textContent;      
    let editText = empty.querySelector(".input-text-area");
    editText.value = messageObj.textContent;
}

/*the provided message object should correspond to the container itself, not to any of its children*/
function updateUserMessageContainer(messageObj, onCurrentPath) {    
    if(messageObj.parentNode != null && messageObj.parentNode.children != null)
        updateChildCounter(messageObj.parentNode);
   updateChildCounter(messageObj);
}

function updateChildCounter(messageObj) {
    let vselector = messageObj.domElem.querySelector('.version-selectors');
    let total_children = vselector.querySelector(".total-index-count");
    let children = messageObj.children ||  {'0':messageObj.messages}; 
    let childCount =  Object.keys(children).length;

    if(childCount <= 1) 
        hideElem(vselector);
    total_children.textContent = childCount;
    let currentIndex = vselector.querySelector(".current-index");
    if(messageObj?.activeDescendants == null && childCount >0) {
        //currentIndex.textContent = inferMessageVersion(messageObj);
        messageObj.activeDescendant = "0";
    } else
        currentIndex.textContent = Number(messageObj?.activeDescendants)+1
    
    total_children.textContent = childCount;
    let activeChild = messageObj.children[messageObj.activeDescendants];
    
    for(let k in messageObj.children) {
        hideElem(messageObj.children[k].domElem);
    }
    if(activeChild != null)
        showElem(activeChild.domElem);
}

function updateAsstMessageContainer(messageObj, onCurrentPath) {
    updateUserMessageContainer(messageObj , onCurrentPath);
    let toUpd = messageObj.domElem;
    let submittedText = toUpd.querySelector(".completed-text-area");
    let submittedControls = submittedText.closest(".completed-text-controls");
    submittedText.textContent = messageObj.textContent;      
    let inProgressText = toUpd.querySelector(".in-progress-response-text-area");
    let inProgressTextControls = inProgressText.closest(".in-progress-text-controls");
    inProgressText.textContent = messageObj.textContent;
    if(messageObj?.state == 'committed' || messageObj?.state == 'idle') {
        hideElem(inProgressTextControls);
        showElem(submittedControls);
    } else {
        hideElem(submittedControls);
        showElem(inProgressTextControls);
    }
}

let hasHydrated = false;
ConvEvents.addListener({event_name: 'convo_tree_restructured', callback: (event)=>{
    if(hasHydrated == false ||convoTree.conversationId != event.payload.conversationId) {
        initConvo(event.payload);
    } 
}});

ConvEvents.addListener({event_name: 'structure_change', callback: (event)=>{
    let nodeObj = event.payload.nodeInfo || event.payload;
    let changeType = event.changeType || event.payload.changeType;
    if(changeType == 'node_added') {
        if(nodeObj.nodeType == 'MessageHistories') {
            if(nodeObj.author == 'user') {
                addUserReply(nodeObj);
            } else if(nodeObj.author == 'assistant') {
                addAsstReply(nodeObj);
            }
        } else if(nodeObj.nodeType == "ThoughtHistories") {
            addThought(nodeObj);
        }
    }
}});

function addThought(nodeObj) {
    let hydrated = hydrateThought(nodeObj);
    nodeObj.domElem = hydrated;
    nodeuuidmap[nodeObj.messagenodeUuid] = nodeObj;
    thoughtToParent(nodeObj);
    return hydrated;
}

function updateThoughtContainer(nodeObj) {
    nodeObj.domElem.thoughtContent.textContent = nodeObj.textContent;
    let asstNode = nodeObj.domElem.closest(".asst-version-area");
    let thoughtButton = asstNode.querySelector(".show-thoughts");
    statPing(thoughtButton);
    updateChildCounter(nodeObj);
}

function hydrateThought(nodeObj) {
    let empty = thoughttext_template.cloneNode(true);
    empty.responseDomElem = empty.querySelector(".response-container");
    empty.subThoughtDomElem = empty.querySelector(".subthought-content");
    empty.thoughtContent = empty.querySelector(".thought-content");
    empty.messaageObj = nodeObj;
    return empty;
}

/**adds a nodeObj to its appropriate parent thought or child map*/
function thoughtToParent(nodeObj) {
    let parentNode = nodeuuidmap[nodeObj.parentNodeUuid];
    nodeObj.parentNode = parentNode;
    let parIndexer = parentNode.children;
    let parContainer = parentNode.responseDomElem;
    if(nodeObj.thoughtType == "subThought") {
        parIndexer = parentNode.thoughts;
        parContainer = parentNode.domElem.subThoughtDomElem;
    } else if (nodeObj.thoughtType == "thoughtReply") {
        parIndexer = parentNode.children;
        parContainer = parentNode.domElem.responseDomElem;
    } else {
        throw new Error("Thoughts must have a type");
    }
    nodeObj.parIndexer = parIndexer;
    nodeObj.parContainer = parContainer;
    nodeObj.parContainer.appendChild(nodeObj.domElem);
    nodeObj.parIndexer[nodeObj.nodeId] = nodeObj.messagenodeUuid;
    updateChildCounter(parentNode);
}



function addUserReply(nodeObj) {
    if(convoTree.conversationId == nodeObj.conversationId) {
        let newMessage = nodeObj;
        let parentNode = nodeuuidmap[nodeObj.parentNodeUuid];
        newMessage.parentNode = parentNode;
        nodeuuidmap[newMessage.messagenodeUuid] = newMessage;
        parentNode.children[newMessage.nodeId] = newMessage;
        convoTree.activePath = getPathTo(newMessage);
        let activeList = historyAsList(convoTree.activePath, null, convoTree.messages);        
        hydrateMessage(newMessage)
        updateUserMessageContainer(parentNode, activeList);
        updateUserMessageContainer(newMessage, activeList);
        forAllSiblings(newMessage, (sib) => {
            hideElem(sib.domElem);
        });
        newMessage.parentNode.activeDescendants = newMessage.nodeId;
        showElem(newMessage.domElem);
        rootward(newMessage, showExclusive);
        //hydrateMessage(newMessage)
    }
}

ConvEvents.addListener({event_name:`asst_reply_init`, callback: (event)=>{
    let nodeObj = event.payload.nodeInfo || event.payload;
    addAsstReply(nodeObj);
}});

function addAsstReply(nodeObj) {
    if(convoTree.conversationId == nodeObj.conversationId) {
        let newMessage = nodeObj;
        let parentNode = nodeuuidmap[nodeObj.parentNodeUuid];
        newMessage.parentNode = parentNode;
        nodeuuidmap[newMessage.messagenodeUuid] = newMessage;
        parentNode.children[newMessage.nodeId] = newMessage;
        
        hydrateMessage(newMessage)
        convoTree.activePath = getPathTo(newMessage);
        let activeList = historyAsList(convoTree.activePath, null, convoTree.messages);
        updateAsstMessageContainer(newMessage, activeList);
        rootward(newMessage, showExclusive);        
    }
}


ConvEvents.addListener({event_name: 'asst_reply_committed', callback: (event)=>{
    let nodeObj = event.payload.nodeInfo || event.payload;
    commitAsstReply(nodeObj);
}});

function commitAsstReply(nodeObj) {
    if(convoTree.conversationId == nodeObj.conversationId) {
        let newMessage = nodeObj;
        let parentNode = nodeuuidmap[nodeObj.parentNodeUuid];
        let currentVersion = nodeuuidmap[nodeObj.messagenodeUuid];
        newMessage.parentNode = parentNode;
        nodeuuidmap[newMessage.messagenodeUuid] = newMessage;
        newMessage.domElem = currentVersion.domElem;
        parentNode.children[newMessage.nodeId] = newMessage;
        convoTree.activePath = getPathTo(newMessage);
        let activeList = historyAsList(convoTree.activePath, null, convoTree.messages);        
        updateAsstMessageContainer(newMessage, activeList);
        rootward(newMessage, showExclusive);   
        //hydrateMessage(newMessage)
    }
}


ConvEvents.addListener({event_name:`content_change`, callback: (event)=>{
    let nodeObj = event.payload.nodeInfo || event.payload;
    if(convoTree.conversationId == nodeObj.conversationId) {
        let newMessage = nodeObj;
        let currentMessageObj = nodeuuidmap[newMessage.messagenodeUuid];
        if(newMessage.deltaChunk == null)
            currentMessageObj.textContent = newMessage.textContent;
        else 
            currentMessageObj.textContent += newMessage.deltaChunk;
        if(nodeObj.nodeType== "ThoughtHistories") {
            updateThoughtContainer(currentMessageObj)
        } else {
            updateAsstMessageContainer(currentMessageObj, [currentMessageObj, currentMessageObj.parentNode]);
            showElem(currentMessageObj.domElem);
            showElem(currentMessageObj.parentNode.domElem);        
        }
    }
}});

/**
 * hides all siblings of the input node,
 * shows the input node.
 * does this recursively up to the root.
 */
function showExclusive(node) {
    forAllSiblings(node, (sib) => {
        hideElem(sib.domElem);
    });
    if(node.parentNode != null) {
        node.parentNode.activeDescendants = node.nodeId;
        showElem(node.domElem);
    }
}

let nodeuuidmap = {};

function hydrateMessage(messageObj) {
    if(messageObj?.author == null || messageObj?.author == 'user') {
        hydrateUserMessageContainer(messageObj, messageObj.domElem || usertext_template.cloneNode(true));
    } else {
        hydrateAssistantMessageContainer(messageObj, messageObj.domElem || assttext_template.cloneNode(true));
    }
}

function updateMessage(messageObj, onCurrentPath) {
    
    if(messageObj?.author == null || messageObj?.author == 'user') {
        updateUserMessageContainer(messageObj, onCurrentPath);
    } else {
        updateAsstMessageContainer(messageObj, onCurrentPath);
    }
}

function forAllSiblings(messageNode, dothing) {
    if(messageNode?.parentNode?.children) {
        if(Object.keys(messageNode?.parentNode?.children).length > 0) {
            let siblings = messageNode?.parentNode?.children;
            for(let k in messageNode?.parentNode?.children) {
                if(siblings[k] != messageNode) {
                    dothing(siblings[k]);
                } 
            }
        }
    }
}

function initConvo(newTree) {
    let oldtree = convoTree;
    convoTree = newTree;
    unregister(oldtree, true, true)
    fauxNode = system_version_template.cloneNode(true);
    fauxNode.responseDomElem = fauxNode.querySelector('.response-container')
    nodeuuidmap = {};
    convoTree.domElem = fauxNode;
    fauxNode.asObj = convoTree;
    document.querySelector(".messages-container").appendChild(fauxNode);
    forAll(convoTree.messages, (c) => {nodeuuidmap[c.messagenodeUuid] = c});
    forAll(convoTree.messages, child=>unregister(child, true, true));
    funneltree(convoTree.messages);//, m => m.children, c => unregister(c, unlisten=true, undom=true));
    let onCurrentPath = historyAsList(convoTree.activePath, convoTree.activePath, convoTree.messages);
    forAll(convoTree.messages, child=>hydrateMessage(child));
    convoTree.messages.domElem.classList.add("root");
    forAll(convoTree.messages, child=>updateMessage(child, onCurrentPath));
    forAll(convoTree.messages, child=>{if(child.parentNode.activeDescendants == child.nodeId) showElem(child.domElem)});
    
    //onCurrentPath.forEach(node => {hideElem(child, onCurrentPath)});
    
    
    hasHydrated = true;
}

if(convoTree != null && convoTree.conversationId != null) {
    initConvo(convoTree);
}

//TODO: make this unecessary. Infers the message version to show by default using activepath in case 
//something gets lost when saving the appropriate default.
function inferMessageVersion(messaageObj) {
    let depth = 0; 
    let currNode = messaageObj;
    while(currNode.parentNode != null) {
        currNode = currNode.parentNode;
        depth++;
    }
    return Number(convoTree.activePath.split("#")[depth])+1;
}


function getNodesOfType(nodetype) {
    let result = [];
    for(let k in nodeuuidmap) {
        if(nodeuuidmap[k].nodeType == nodetype)
            result.push(nodeuuidmap[k]);
    }
    return result;
}


function statPing(button) {
    button.classList.add('pinged');
    setTimeout(function() {
        button.classList.add('fade-out');
        setTimeout(function() {
            button.classList.remove('pinged');
            button.classList.remove('fade-out'); 
            //setTimeout(function() {            
                   
            //}, 150);
        }, 250)
    }, 40);
}