const usertext_template = document.getElementById('usertext-versionTemplate').content.querySelector(".usertext-version-area");
const assttext_template = document.getElementById('asst-versionTemplate').content.querySelector(".asst-version-area");
const system_version_template = document.getElementById('versionTemplate').content.querySelector(".version-area");



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
    const currentMessageNode = button.closest('.message-node');
    const vselectors = button.closest('.version-selectors');
    let asObj = currentMessageNode.asObj;
    let allChildNodes = [];
    let childrens = currentMessageNode.querySelector('.response-container');
    let child = childrens.firstChild;

    while (child) {
        if (child.nodeType === 1 && child.classList.contains('message-node')) {
            allChildNodes.push(child);
            hideElem(child)
        }
        child = child.nextSibling;
    }
    
    if(Object.keys(asObj.children).length == 0) {
        hideElem(vselectors);
        return;
    }
    asObj.activeDescendants = asObj.activeDescendants == undefined ? '0' : asObj.activeDescendants;
    const currentIndex = Number(asObj.activeDescendants);
    let newIndex = (allChildNodes.length + currentIndex + direction) % allChildNodes.length;
    let newactive = allChildNodes[newIndex];
    showElem(newactive);
    asObj.activeDescendants = newactive.asObj.nodeId;
    let activeList = activeAsList(convoTree.messages)
    convoTree.activePath = getPathTo(activeList[activeList.length-1]);
    let currindicator = currentMessageNode.querySelector(".current-index");
    currindicator.textContent = (Number(asObj.activeDescendants)+1)+'';
    showExclusive(newactive.asObj);
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
    let index_indicator = empty.querySelector(".index-indicator");
    messageObj.domElem = empty;
    empty.asObj = messageObj
    let parDom = null; 
    if(messageObj.parentNode != null) {
        parDom = messageObj.parentNode.domElem;        
    } else {
        parDom = convoTree.domElem;
        messageObj.parentNode = convoTree;
    }
    parDom.querySelector(".response-container").appendChild(empty);
    let vselectors = empty.querySelector(".version-selectors");
    let currentIndex = index_indicator.querySelector(".current-index");
    let total_children = index_indicator.querySelector(".total-index-count");
    if(messageObj?.children) {
        total_children.textContent = Object.keys(messageObj.children).length;
        if(Object.keys(messageObj.children).length > 0) {
            showElem(vselectors);
            currentIndex.textContent = Number(messageObj.activeDescendants)+1;
        } else {
            hideElem(vselectors);
        }
    } else {
        hideElem(vselectors);
    }
      
    
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
    let contaier = messageObj.domElem;
    let total_children = contaier.querySelector(".total-index-count");
    total_children.textContent = Object.keys(messageObj.children).length;
    if(onCurrentPath?.includes(messageObj)) {
        let currentIndex = contaier.querySelector(".current-index");
        currentIndex.textContent = Number(messageObj.activeDescendants)+1
    } else if(onCurrentPath != null 
    && messageObj?.parentNode.activeDescendants != messageObj?.nodeId) {
        hideElem(contaier);
    }
}

function updateAsstMessageContainer(messageObj, onCurrentPath) {
    updateUserMessageContainer(messageObj , onCurrentPath);
    let toUpd = messageObj.domElem;
    let submittedText = toUpd.querySelector(".completed-text-area");
    submittedText.textContent = messageObj.textContent;      
    let inProgressText = toUpd.querySelector(".in-progress-response-text-area");
    inProgressText.textContent = messageObj.textContent;
    if(messageObj?.state == 'committed' || messageObj?.state == 'idle') {
        hideElem(inProgressText);
        showElem(submittedText);
    } else {
        hideElem(submittedText);
        showElem(inProgressText);
    }
}

let hasHydrated = false;
ConvEvents.addListener({type: 'convo_tree_restructured', callback: (event)=>{
    if(hasHydrated == false ||convoTree.conversationId != event.payload.conversationId) {
        initConvo(event.payload);
    } 
}});


ConvEvents.addListener({type: 'reply_committed', callback: (event)=>{
    if(convoTree.conversationId == event.payload.conversationId) {
        let newMessage = event.payload;
        let parentNode = nodeuuidmap[event.payload.parentNodeUuid];
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
}});


ConvEvents.addListener({type: 'asst_reply_committed', callback: (event)=>{
    if(convoTree.conversationId == event.payload.conversationId) {
        let newMessage = event.payload;
        let parentNode = nodeuuidmap[event.payload.parentNodeUuid];
        let currentVersion = nodeuuidmap[event.payload.messagenodeUuid];
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
}});

ConvEvents.addListener({type:`asst_reply_init`, callback: (event)=>{
    if(convoTree.conversationId == event.payload.conversationId) {
        let newMessage = event.payload;
        let parentNode = nodeuuidmap[event.payload.parentNodeUuid];
        newMessage.parentNode = parentNode;
        nodeuuidmap[newMessage.messagenodeUuid] = newMessage;
        parentNode.children[newMessage.nodeId] = newMessage;
        
        hydrateMessage(newMessage)
        convoTree.activePath = getPathTo(newMessage);
        let activeList = historyAsList(convoTree.activePath, null, convoTree.messages);
        updateAsstMessageContainer(newMessage, activeList);
        rootward(newMessage, showExclusive);        
    }
}});

ConvEvents.addListener({type:`asst_reply_updated`, callback: (event)=>{
    if(convoTree.conversationId == event.payload.conversationId) {
        let newMessage = event.payload;
        let currentMessageObj = nodeuuidmap[newMessage.messagenodeUuid];
        currentMessageObj.textContent = newMessage.textContent;
        updateAsstMessageContainer(currentMessageObj, [currentMessageObj, currentMessageObj.parentNode]);
        showElem(currentMessageObj.domElem);
        showElem(currentMessageObj.parentNode.domElem);
        
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
    nodeuuidmap = {};
    convoTree.domElem = fauxNode;
    fauxNode.asObj = convoTree;
    document.querySelector(".messages-container").appendChild(fauxNode);
    forAll(convoTree.messages, (c) => {nodeuuidmap[c.messagenodeUuid] = c});
    forAll(convoTree.messages, child=>unregister(child, true, true));
    funneltree(convoTree.messages);//, m => m.children, c => unregister(c, unlisten=true, undom=true));
    let onCurrentPath = historyAsList(convoTree.activePath, convoTree.activePath, convoTree.messages);
    forAll(convoTree.messages, child=>hydrateMessage(child));
    forAll(convoTree.messages, child=>updateMessage(child, onCurrentPath));
    forAll(convoTree.messages, child=>{if(child.parentNode.activeDescendants == child.nodeId) showElem(child.domElem)});
    convoTree.messages.domElem.classList.add("root");
    //onCurrentPath.forEach(node => {hideElem(child, onCurrentPath)});
    
    
    hasHydrated = true;
}

if(convoTree != null && convoTree.conversationId != null) {
    initConvo(convoTree);
}