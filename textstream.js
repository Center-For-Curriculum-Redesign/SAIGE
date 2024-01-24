await import('dotenv/config');
import express from 'express';
import * as dummy_text from './dummy_text.js';
import * as convos from './chat_history.js';
import { v4 as uuidv4 } from 'uuid';
import * as prompts from './assistant_logic/reasoning_prompts.js';
import * as asst from './assistant_logic/saigent.js';
import { EventStreamer } from './event_streamer.js';

import fss from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { basicPromptInst, promptSearcher } from './assistant_logic/basic/basic.js';
import {selfRagPromptInst} from './assistant_logic/selfrag/selfrag.js';
import { createSecureServer } from 'http2';
import http2Express from 'http2-express-bridge';
import { ponderPromptInst } from './assistant_logic/basic/consider.js';
import { getETA, heartbeatEmbedding } from './external_hooks/replicate_embeddings.js';

const app = http2Express(express);
const privateKey = fss.readFileSync('tls/privkey.pem', 'utf8');
const certificate = fss.readFileSync('tls/fullchain.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };
const ccrkey = fss.readFileSync('../server-vars/saige_key.txt', 'utf8');
const port = 3333;
const httpsServer = createSecureServer(credentials, app);

httpsServer.on('error', (err)=> {
    console.error('Server failed to start:', err);
});
httpsServer.listen(port, (err) => {
    console.log(`HTTPS Server running on port ${port}`);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONVO_DIR = path.join(__dirname, 'conversations'); 
const ENDPOINT_DIR = path.join(__dirname, 'endpoints_available/known_endpoints.json'); 
if (!fss.existsSync(CONVO_DIR)) {
    fss.mkdirSync(CONVO_DIR, { recursive: true });
}
function getConvoPath(key) {
    return path.join(CONVO_DIR, `${key}.json`);
}

app.use(express.static('static'));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', './views');

const conversation_cache = {}; //map of conversationuuids to conversation objects.
const asst_cache = {}; //map of conversationuuids to assistant instances.
const event_streamers = {}; //map of conversationuuids to sse event streams.
//map of models to urls
export const endpoints_available = JSON.parse(fss.readFileSync(ENDPOINT_DIR, 'utf8'));
console.log(endpoints_available);


app.get('/chat/', async (req, res) => {
    let convo_tree = await find_load_make_convo('new', null);
    res.render('chat', { convo_tree });
})

app.get('/chat/:key', async (req, res) => {
    console.log(getETA())
    const key = req.params.key;
    let convo_tree = await find_load_make_convo(key, null);
    res.render('chat', { convo_tree });
});

app.post('/notify', async (req, res) => {
    const model_registration = req.body;
    if(model_registration?.notification_type == "register") {
        endpoints_available[model_registration.model_available] = endpoints_available[model_registration.model_available] ||[];
        endpoints_available[model_registration.model_available] = [model_registration.access_url, ...endpoints_available[model_registration.model_available]];
        fs.writeFile(ENDPOINT_DIR, JSON.stringify(endpoints_available));
    }
    res.send();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/public/index.html'));
});

app.post('/prompt_internal', async (req, res) => {
	if(await checkServerAuth(req,res) == false) return;
    const replyContent = req.body;
    let convo_tree = await find_load_make_convo(replyContent.conversationId);
    let eventStreamer = event_streamers[convo_tree.conversationId]; 
    let assistant = asst_cache[convo_tree.conversationId];
    let new_reply = replyContent.replyingTo
    	? convo_tree.addReplyToUuid(replyContent.replyingTo,'user',replyContent.prompt)
    	: convo_tree.addReply(null,'user',replyContent.prompt);
    new_reply.conversationId = convo_tree.conversationId;
    let responseTo = new_reply.toJSON();
    eventStreamer.broadcastEvent({
        event_name: 'user_reply_committed',
        messageuuid: responseTo.messagenodeUuid,
        conversationId: convo_tree.conversationId,
        textContent: responseTo.textContent
    });
    res.json(new_reply);

// test code, with dummy response

/*
    let resultNode = new convos.MessageHistories('assistant', '');
    resultNode.setIntendedParentNode(new_reply);
    let messagenodeUuid = resultNode.toJSON().messagenodeUuid;
    eventStreamer.broadcastEvent({
    	event_name: 'asst_reply_init',
    	messageuuid: messagenodeUuid,
       	conversationId: convo_tree.conversationId
    });
    let textstream = dummy_text.asyncIntGen(500, 100);
    let accumulated = "";
    (async () => {
        for await (const chunk of textstream) {
            let deltachunk = chunk.choices[0]?.delta?.content || ""
            accumulated += ' '+deltachunk;
            eventStreamer.broadcastEvent({
            	event_name: 'asst_reply_updated',
            	data: deltachunk,
            	textContent: accumulated,
            	messageuuid: messagenodeUuid,
            	conversationId: convo_tree.conversationId
            });
        }
		eventStreamer.broadcastEvent({
			event_name: 'asst_reply_committed',
			textContent: accumulated,
			messageuuid: messagenodeUuid,
           	conversationId: convo_tree.conversationId,
           	responseTo: new_reply.toJSON().messagenodeUuid
		});
        new_reply.addChildReply(resultNode);
        new_reply.setPath(resultNode.getNodeId());
        resultNode.setContent(accumulated);
        resultNode.setState('committed');
        const filePath = getConvoPath(convo_tree.conversationId);
        convo_tree.save(fs, filePath);
    }) ();
*/

// real code, with asst response

    //save to disk after the assistant replies.
    initAssistantResponseTo(assistant, new_reply, 
        (genned_reply) => {
            const filePath = getConvoPath(convo_tree.conversationId);
            convo_tree.save(fs, filePath);
        }
    );

});

app.post('/chat_commands/:key', async (req, res) => {
    const replyContent = req.body;
    const key = req.params.key;
    let convo_tree = await find_load_make_convo(replyContent.conversationId, null);
    //let eventStreamer = event_streamers[convo_tree.conversationId]; 
    let assistant = asst_cache[convo_tree.conversationId];
    if(key.endsWith('_reply')) {
        let replyTo = convo_tree.getNodeByUuid(replyContent.replyingTo);
        if(key == 'user_reply') {
            replyTo = convo_tree.addReplyToUuid(replyContent.replyingTo, replyContent.asAuthor, replyContent.withContent, true);
            replyTo.conversationId = convo_tree.conversationId;
        }
        /*eventStreamer.broadcastEvent({
            event_name: 'reply_committed',
            payload: new_reply.toJSON()
        });*/
        //save to disk after the assistant replies.
        initAssistantResponseTo(assistant, replyTo,
            (genned_reply) => {
                const filePath = getConvoPath(convo_tree.conversationId);
                convo_tree.save(fs, filePath);
            });
    }
})

app.get('/chat_events/:key', async (req, res) => {
    const key = req.params.key;
    const conversation = await find_load_make_convo(key, res, true);
    /*if(conversation != null) {
        event_streamers[conversation.conversationId].registerListener(res);
    }   

    req.on('close', () => {
        if(conversation != null) {
            event_streamers[conversation?.conversationId].removeListener(res);
            console.log('Client disconnected');
        }
    });*/
});


app.get('/events/', function(req, res) {
    const evst = new EventStreamer(res);
    let textstream = dummy_text.asyncIntGen(50, 100);
    let accumulated = "";
    (async () => {
        for await (const chunk of textstream) {
            let deltachunk = chunk.choices[0]?.delta?.content || ""
            accumulated += ' '+deltachunk;
            evst.broadcastEvent({ event_name: 'pingchunk', chunk_content: deltachunk, timestamp: new Date() });
        }
        evst.broadcastEvent({ event_name: 'commit', content: accumulated, timestamp: new Date() });
        
        console.log('Client disconnected');
        evst.removeListener(res);
    }) ();
});


/*retrieves convo from cache if available, or file if not available, or new convo if neither*/
async function find_load_make_convo(key, res, make=true){
    let convo_tree = null;
    let asst = null;
    convo_tree = conversation_cache[key];        
    if(convo_tree == null) {
        const filePath = getConvoPath(key);
        convo_tree = await convos.Convo.load(fs, filePath);
        if(convo_tree != null) {
            conversation_cache[convo_tree.conversationId] = convo_tree;
            asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
        }
    }
    if(convo_tree == null) {
        let convo_uuid = key;
        convo_tree = new convos.Convo(convo_uuid);
        conversation_cache[convo_tree.conversationId] = convo_tree;
        convo_tree.initRoot();
        const filePath = getConvoPath(convo_tree.conversationId);
        asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
        convo_tree.save(fs, filePath)
    } 
/*    
	    else {
        convo_tree = conversation_cache[key];        
    }
 
    if(convo_tree == null) {
        const filePath = getConvoPath(key);
        convo_tree = await convos.Convo.load(fs, filePath);
        if(convo_tree != null) {
            conversation_cache[convo_tree.conversationId] = convo_tree;
            asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
        }
    }
    convo_tree = conversation_cache[key];
    if(convo_tree == null && make) {
        let convo_uuid = uuidv4();
        convo_tree = new convos.Convo(convo_uuid);
        convo_tree.initRoot();
        conversation_cache[convo_tree.conversationId] = convo_tree;
        const filePath = getConvoPath(convo_tree.conversationId);
        asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
        convo_tree.save(fs, filePath)
    }
*/
    if(convo_tree != null) {
        if(event_streamers[convo_tree.conversationId] == null)
            event_streamers[convo_tree.conversationId] = new EventStreamer(res);
            asst_cache[convo_tree.conversationId] = asst_cache[convo_tree.conversationId] || initAsstFor(convo_tree);
    }

    let streamer = event_streamers[convo_tree.conversationId];
    if(res != null) 
        streamer.registerListener(res);
    convo_tree.on_textContent_change = (newNode) => {
        let currStream = event_streamers[convo_tree.conversationId];
        currStream.broadcastEvent({
            event_name: 'content_change',
            payload: newNode.nodeInfo
        })

    }
    convo_tree.on_structure_change = (newNode)=> {
        let currStream = event_streamers[convo_tree.conversationId];
        currStream.broadcastEvent({
            event_name: 'structure_change',
            payload: newNode
        })
    };
    return convo_tree
}

function initAsstFor(convoTree, evst){    
    let newAsst = new asst.ASST(convoTree)
    //let dummy_text = basicPromptInst(newAsst, endpoints_available);
    let dummy_text = ponderPromptInst(newAsst, endpoints_available);
    //let dummy_text = selfRagPromptInst(newAsst, endpoints_available);//promptSearcher(newAsst, endpoints_available);
    newAsst.init(dummy_text)
    return newAsst;
}

function initAssistantResponseTo(asst, responseTo, commit_callback) {
    let resultNode = new convos.MessageHistories('assistant', '');
    resultNode.setIntendedParentNode(responseTo);
    let data = resultNode.toJSON();
    let streamer = event_streamers[responseTo.conversationId];
    streamer.broadcastEvent({
        event_name: 'asst_reply_init',
        messageuuid: data.messagenodeUuid,
        conversationId: data.conversationId,
        responseTo: responseTo.toJSON().messagenodeUuid
    })
    asst.on_commit = (commit_packet, byasst) => {
        responseTo.addChildReply(resultNode);
        responseTo.setPath(resultNode.getNodeId());
        resultNode.setContent(commit_packet);
        let data = resultNode.toJSON();
        resultNode.setState('committed');
        if(commit_callback) {
            commit_callback(resultNode);
        }
        streamer.broadcastEvent({
            event_name: 'asst_reply_committed',
            textContent:resultNode.textContent,
            messageuuid: data.messagenodeUuid,
         	conversationId: data.conversationId,
         	responseTo: responseTo.toJSON().messagenodeUuid
       })
    };

    asst.on_state_change  = (generate_packet, byasst) => {
//        resultNode.textContent += generate_packet.delta_content;
//        resultNode.fullPacket = generate_packet;
//        resultNode.setState(generate_packet.changedVal);
        let data = resultNode.toJSON();
        streamer.broadcastEvent({
            event_name: 'asst_state_updated',
            messageuuid: data.messagenodeUuid, 
	        conversationId: data.conversationId,
	        state: data.state,
	        responseTo: responseTo.toJSON().messagenodeUuid
        })
    };
/*
    asst.on_generate  = (generate_packet, byasst) => {
        resultNode.textContent += generate_packet.delta_content;
//        resultNode.fullPacket = generate_packet;
//        resultNode.setState(generate_packet.changedVal);
        let data = resultNode.toJSON();
        data.deltaChunk = generate_packet.delta_content;
        streamer.broadcastEvent({
            event_name: 'asst_reply_updated',
            payload: data
        })
    };
*/
    try {
        asst.replyInto(resultNode);
    } catch (e) {
        resultNode.setContent("Sorry, I seem to have encountered an error. Maybe try again in a few minutes?", true);
    }
}

async function checkServerAuth(req,res) {
	if (req.header('Authorization') === 'Bearer '+ccrkey) return true;
	res.status(401).send('Unauthorized request.');
	return false;
        resultNode.setState('generating');
        
    }
