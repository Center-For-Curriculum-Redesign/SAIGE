await import('dotenv/config');
import express from 'express';
import morgan from 'morgan';
import * as dummy_text from './dummy_text.js';
import * as convos from './chat_history.js';
import { v4 as uuidv4 } from 'uuid';
import * as prompts from './assistant_logic/reasoning_prompts.js';
import * as asst from './assistant_logic/saigent.js';
import { EventStreamer } from './event_streamer.js';
import fetch from 'node-fetch';
import got from 'got';
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
import { _localgetSimilarEmbeddings, _localExpandChunk } from './external_hooks/pg_accesss.js';
import crypto from 'crypto';

const app = http2Express(express);
const privateKey = fss.readFileSync('tls/privkey.pem', 'utf8');
const certificate = fss.readFileSync('tls/fullchain.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };
const ccrkey = process.env.CCR_KEY;
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
const ENDPOINT_DIR = path.join(__dirname, 'endpoints_available'); 

/*php will send claims about which user_id maps to which token. The tokens are generated
by our shared_key + a salt string php provides when declaring a user. 
We store the salt string, and whenever a user asks us for stuff, we take their token and decrypt it with key+salt
*/


if (!fss.existsSync(CONVO_DIR)) {
    fss.mkdirSync(CONVO_DIR, { recursive: true });
}

let TOKEN_USER_MAP = {};
try {
    TOKEN_USER_MAP = JSON.parse(fss.readFileSync(ENDPOINT_DIR+'/known_users.json', 'UTF-8'));
} catch(e) {
    console.log("oh no");
}

function getConvoPath(key) {
    return path.join(CONVO_DIR, `${key}.json`);
}

app.use(express.static('static'));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(morgan('combined'));
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const conversation_cache = {}; //map of conversationuuids to conversation objects.
const asst_cache = {}; //map of conversationuuids to assistant instances.
const event_streamers = {}; //map of conversationuuids to sse event streams.
//map of models to urls
export const endpoints_available = JSON.parse(fss.readFileSync(ENDPOINT_DIR+'/known_endpoints.json', 'utf8'));
console.log(endpoints_available);

async function setUserTokenIds(req, res) {
    let auth = await checkServerAuth(req, res);
    try{
        if(req.headers['x-custom-session-id'] != null && auth) { //branch for claims from trusted server
            let salt = req.headers['x-custom-salt'];
            //let user_id = decrypt(ccrkey, salt, req.headers['x-custom-user-token']);
            let user_token =  req.headers['x-custom-user-token'];
            let user_id = req.headers['x-custom-user-id'];
            //TOKEN_USER_MAP doesn't actually contain anything sensistive, login is handled by the php server,
            // this is just there to check that a user talking to this server is who s/he claims to be on the php server
            TOKEN_USER_MAP[user_token] = {'salt': salt, 'user_id': user_id}
            req.user_id = user_id
            await fs.writeFile(ENDPOINT_DIR+'/known_users.json', JSON.stringify(TOKEN_USER_MAP), 'utf8');
        } else { //branch for claims from whoever-the-fuck.            
            let token = req?.token || req?.body?.token || req?.params?.token || req?.query?.token; 
            if(TOKEN_USER_MAP[token]) {
                //let purporteduser_id = req?.user_id || req?.params?.user_id || req?.query?.user_id || req?.body?.user_id;
                req.user_id = TOKEN_USER_MAP[token]['user_id'] || token;               
                /*let salt = TOKEN_USER_MAP[token]['salt'];
                let decrypted_user_id = decrypt(ccrkey, salt, token);
                let matched_user_id = TOKEN_USER_MAP[token]['user_id'];
                if(matched_user_id != decrypted_user_id) {
                    req.user_id = 'global';
                } else {
                    req.user_id = decrypted_user_id;
                }*/
            } else {
                req.user_id = 'global'
            }
        }
    } catch(e) {
        req.user_id = 'global';
    }
    res.user_id = req.user_id;
    return req;
}

app.get('/chat/', async (req, res) => {
    if(! await forceServerAuth(req, res)) return;
    req = await setUserTokenIds(req, res)
    console.log('hit /chat/')
    let key = 'new';
    if(req.query.convo) {
        key = req.query.convo;
    }
    let convo_tree = await find_load_make_convo(null, null, true, req);
    if(req.query.convo != null) {
        res.json(convo_tree);
    } else {
        res.render('chat', { convo_tree });
    }
})

app.get('/chat/:key', async (req, res) => {
    if(! await forceServerAuth(req, res)) return; 
    req = await setUserTokenIds(req, res)
    //console.log(getETA())
    console.log('hit /chat/:key')
    let key = req.params.key;
    let convo_tree = await find_load_make_convo(key, null, true, req);
    if(req.query.convo != null) {
        res.json(convo_tree);
    } else {
        res.render('chat', { convo_tree });
    }
});

app.post('/notify', async (req, res) => {
    console.log('hit /notify');
    const model_registration = req.body;
    if(model_registration?.notification_type == "register") {
        endpoints_available[model_registration.model_available] = endpoints_available[model_registration.model_available] ||[];
        endpoints_available[model_registration.model_available] = [model_registration.access_url, ...endpoints_available[model_registration.model_available]];
        fs.writeFile(ENDPOINT_DIR+'/known_endpoints.json', JSON.stringify(endpoints_available));
    }
    res.send();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/public/index.html'));
});

app.post('/prompt_internal', async (req, res) => {
    if(! await forceServerAuth(req, res)) return; 
	req = await setUserTokenIds(req, res)
    console.log('hit /prompt_internal');
    const replyContent = req.body;
    let convo_tree = await find_load_make_convo(replyContent.conversationId, null, true, req);
    let eventStreamer = event_streamers[convo_tree.conversationId]; 
    let assistant = asst_cache[convo_tree.conversationId];
    let new_reply = replyContent.replyingTo
    	? convo_tree.addReplyToUuid(replyContent.replyingTo,'user',replyContent.prompt)
    	: convo_tree.addReply(null,'user',replyContent.prompt);
    new_reply.conversationId = convo_tree.conversationId;
    let responseTo = new_reply.toJSON();
    eventStreamer.broadcastEvent({
        event_name: 'user_reply_committed',
        messagenodeUuid: responseTo.messagenodeUuid,
        conversationId: convo_tree.conversationId,
        textContent: responseTo.textContent
    }, req.user_id);
    res.json(new_reply);

// test code, with dummy respons
// real code, with asst response

    //save to disk after the assistant replies.
    initAssistantResponseTo(assistant, new_reply, 
        (genned_reply) => {
            const filePath = getConvoPath(convo_tree.conversationId);
            convo_tree.save(fs, filePath);
        }, req.user_id
    );

});

app.get('/eta', async(req,res) => {
	let eta = await getETA();
	res.json({eta:eta});
});

app.post('/chat_commands/:key', async (req, res) => {
    req = await setUserTokenIds(req, res)
    console.log('hit /chat_commands/:key');
    const replyContent = req.body;
    const key = req.params.key;
    let convo_tree = await find_load_make_convo(replyContent.conversationId, res, true, req);
    //let eventStreamer = event_streamers[convo_tree.conversationId]; 
    let assistant = asst_cache[convo_tree.conversationId];
    if(key.endsWith('_reply')) {
        let replyTo = convo_tree.getNodeByUuid(replyContent.replyingTo);
        if(replyTo != null) {
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
    }
    if(key == "cancel_request") {
        assistant.cancelRequest();
    }
})

app.get('/chat_events/:key', async (req, res) => {
    req = await setUserTokenIds(req, res)
    console.log('hit /chat_events');
    const key = req.params.key;
    const conversation = await find_load_make_convo(key, res, true, req);
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


app.post('/expand_chunk', async (req, res) => {
    if(! await forceServerAuth(req, res)) return;  
    console.log('hit /force_chunk');
    const rc = req.body;   
    let result = await _localExpandChunk(rc.input_chunk, rc.n_before, rc.n_after);
    res.json(result);
});

app.post('/get_similarity', async (req, res) => { 
    if(! await forceServerAuth(req, res)) return; 
    console.log('hit /get_similarity');
    const rc = req.body;
    let embeddings_list = rc.embeddings_list;
    let granularities = rc.granularities_list;
    let additionalFilters = rc.additional_filters;
    let result = await _localgetSimilarEmbeddings(embeddings_list, granularities, additionalFilters);
    res.json(result)    
});
app.post('/get_endpoints', async (req, res) => {
    if(! await forceServerAuth(req, res)) return; 
    const rc = req.body;
    let embeddings_list = rc.embeddings_list;
    let granularities = rc.granularities_list;
    let additionalFilters = rc.additional_filters;
    let result = await _localgetSimilarEmbeddings(embeddings_list, granularities, additionalFilters);
    res.json(result)    
});


app.get('/events/:user_token', async (req, res) => {
    const evst = new EventStreamer(res, req.user_id);
    let textstream = dummy_text.asyncIntGen(50, 100);
    let accumulated = "";
    (async () => {
        for await (const chunk of textstream) {
            let deltachunk = chunk.choices[0]?.delta?.content || ""
            accumulated += ' '+deltachunk;
            evst.broadcastEvent({ event_name: 'pingchunk', chunk_content: deltachunk, timestamp: new Date()}, req.user_id );
        }
        evst.broadcastEvent({ event_name: 'commit', content: accumulated, timestamp: new Date() }, req.user_id );
        
        console.log('Client disconnected');
        evst.removeListener(res);
    }) ();
});


/*retrieves convo from cache if available, or file if not available, or new convo if neither*/
async function find_load_make_convo(key, res, make=true, req = {user_id:'global'}){
    let convo_tree = null;
    let asst = null;
    convo_tree = conversation_cache[key];        
    if(convo_tree == null && key != null) {
        const filePath = getConvoPath(key);
        convo_tree = await convos.Convo.load(fs, filePath);
        if(convo_tree != null) {
            if(convo_tree.conversationId == null ) {
                convo_tree.conversationId = key || uuidv4();
            }
            if(convo_tree.user_id == null)
                convo_tree.user_id = 'global'
            if(convo_tree.user_id != req.user_id && convo_tree.user_id != 'global') {
                convo_tree = null;
            } else {
                conversation_cache[convo_tree.conversationId] = convo_tree; 
                asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
            }
        }
    }
    if(convo_tree == null) {
        let convo_uuid = key;
        if(convo_uuid == null || convo_uuid == '')
            convo_uuid = uuidv4();
        convo_tree = new convos.Convo(convo_uuid);
        convo_tree.user_id = req.user_id;
        conversation_cache[convo_tree.conversationId] = convo_tree;
        convo_tree.initRoot();
        const filePath = getConvoPath(convo_tree.conversationId);
        asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
        convo_tree.save(fs, filePath)
    }
    
    /*if(convo_tree == null) {
        const filePath = getConvoPath(key);
        convo_tree = await convos.Convo.load(fs, filePath);
        if(convo_tree != null) {
            if(convo_tree.user_id == null)
                convo_tree.user_id = 'global'
            if(convo_tree.user_id != req.user_id && convo_tree.user_id != 'global') {
                convo_tree = null;
            } else {
                conversation_cache[convo_tree.conversationId] = convo_tree;
                asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
            }
        }
    }
    convo_tree = conversation_cache[key];
    if(convo_tree == null && make) {
        let convo_uuid = uuidv4();
        convo_tree = new convos.Convo(convo_uuid);
        convo_tree.user_id = req.user_id;
        convo_tree.initRoot();
        conversation_cache[convo_tree.conversationId] = convo_tree;
        const filePath = getConvoPath(convo_tree.conversationId);
        asst_cache[convo_tree.conversationId] = initAsstFor(convo_tree);
        convo_tree.save(fs, filePath)
    }*/

    let streamer = null;
    if(convo_tree != null) {
        if(convo_tree.user_id == null)
            convo_tree.user_id = 'global'        
        if(convo_tree.user_id != req.user_id && convo_tree.user_id != 'global') {
            convo_tree = null;
        } else {
            if(event_streamers[convo_tree.conversationId] == null && res != null) {
                event_streamers[convo_tree.conversationId] = new EventStreamer(res, res.user_id);
                asst_cache[convo_tree.conversationId] = asst_cache[convo_tree.conversationId] || initAsstFor(convo_tree);
            }            
        }
        streamer = event_streamers[convo_tree.conversationId];
    }

    
    
    if(res != null) 
        streamer.registerListener(res, res.user_id);

    convo_tree.on_textContent_change = (newNode) => {
        let currStream = event_streamers[convo_tree.conversationId];
        currStream.broadcastEvent({
            event_name: 'content_change',
            payload: newNode.nodeInfo
        }, req.user_id)

    }
    convo_tree.on_structure_change = (newNode)=> {
        let currStream = event_streamers[convo_tree.conversationId];
        currStream.broadcastEvent({
            event_name: 'structure_change',
            payload: newNode
        }, req.user_id)
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

function initAssistantResponseTo(asst, responseTo, commit_callback, user_id) {
    let resultNode = new convos.MessageHistories('assistant', '');
    resultNode.setIntendedParentNode(responseTo);
    let data = resultNode.toJSON();
    let streamer = event_streamers[responseTo.conversationId];
    streamer.broadcastEvent({
        event_name: 'asst_reply_init',
        messagenodeUuid: data.messagenodeUuid,
        conversationId: data.conversationId,
        responseTo: responseTo.toJSON(),
        payload: resultNode.toJSON()
    }, user_id)
    asst.on_commit = (commit_packet, byasst, throughNode) => {
        let responseTo = throughNode?.parentNode ?? responseTo;
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
            messagenodeUuid: data.messagenodeUuid,
         	conversationId: data.conversationId,
         	responseTo: responseTo.toJSON().messagenodeUuid,
            payload: resultNode.toJSON()
       }, user_id)
    };

    asst.on_state_change  = (generate_packet, byasst, throughNode) => {
//        resultNode.textContent += generate_packet.delta_content;
//        resultNode.fullPacket = generate_packet;
//        resultNode.setState(generate_packet.changedVal);
        let forNode = throughNode == null ? resultNode : throughNode;
        let responseToPar = forNode?.parentNode ?? responseTo;
        let data = forNode.toJSON();
        streamer.broadcastEvent({
            event_name: 'asst_state_updated',
            messagenodeUuid: data.messagenodeUuid, 
	        conversationId: data.conversationId,
	        state: data.state,
	        responseTo: responseToPar.toJSON().messagenodeUuid,
            payload: forNode.toJSON()
        }, user_id)
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
        }, user_id)
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
	return false;        
}

async function forceServerAuth(req,res) {
	if (req.header('Authorization') === 'Bearer '+ccrkey) return true;
	res.status(401).send('Unauthorized request.');
	return false;        
}


export async function doFetchPost(url, data) {    
    try {
        const response = await got.post(url, {
            http2: true,
            json: data,
            responseType: 'json'
        });

        return response.body;
    } catch (error) {
        console.error(error.response.body);
    }
}

function decrypt(key, salt, encryptedData) {
    try {
        const hashedKey = crypto.createHash('sha256').update(key+salt).digest();
        const dataBuffer = Buffer.from(encryptedData, 'base64');

        const ivLength = crypto.getCipherInfo('aes-256-cbc').ivLength;
        const iv = dataBuffer.slice(0, ivLength);
        const ciphertext = dataBuffer.slice(ivLength);
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', hashedKey, iv);
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString();
    } catch(e) {
        throw new Error(e);
    }
}




