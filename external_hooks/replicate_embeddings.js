await import('dotenv/config');
console.log(process.env.REPLICATE_API_TOKEN);
import Replicate from "replicate";
import fss from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN
});
var response_tracker = null;

/**returns an esitmate of how long until the embedding endpoint becomes available*/
export const getETA = async () => {
    console.log("using key: "+ process.env.REPLICATE_API_TOKEN);
    await maybeLoadResponseTracker();
    const currentTime = Date.now();
    const sinceLast = currentTime - response_tracker.last_response
    let ETA = 120000;

    //if it's been less than 3 minutes since the last response and less than 2 seconds between that and 
    // the last request, we can be pretty sure-ish the endpoint is still up.
    if(sinceLast < 180000 && 
        (response_tracker.last_response - response_tracker.last_request) < 2000) {
        ETA = 0;
    } else if(sinceLast < 120000) {
        ETA = sinceLast;
    }else {        
        ETA = 130000
    }
    response_tracker.last_request = Date.now();
    heartbeatEmbedding(()=>updateRsponseTracker());
    return ETA;
}

const updateRsponseTracker = async () => {
    response_tracker.prev_request = response_tracker.last_request;
    response_tracker.prev_response = response_tracker.last_response;
    response_tracker.last_response = Date.now();  
    await fs.writeFile(path.join(__dirname,"last_response.json"), JSON.stringify(response_tracker));
}

export const heartbeatEmbedding = async (oncomplete) => {    
    await queryEmbRequest(['doki_doki']); 
    oncomplete()
}

export const getEmbeddings = async  (queries, granularities) => {
    await maybeLoadResponseTracker();
    const currentTime = Date.now();
    response_tracker.last_request = Date.now();
    let results = {}
    console.log("chromadb call for " +queries.length + " queries")
    let stringEmbs = [...await queryEmbRequest(queries)]
    updateRsponseTracker()
    return stringEmbs;
}

export const queryEmbRequest = async (q_arr) => {
    var result = await replicate.run(
        "center-for-curriculum-redesign/bge_1-5_query_embeddings:438621acdb4511d2d9c6296860588ee6c60c3df63c93e2012297db8bb965732d",
        {
          input: {
            query_texts: JSON.stringify(q_arr),
            precision: 'half'
          }
        });
    return result?.query_embeddings;
}

const maybeLoadResponseTracker = async () => {
    if(response_tracker == null) {
        try {
            response_tracker = JSON.parse(await fs.readFileSync(path.join(__dirname,"last_response.json"), 'utf8'));
        } catch(e){ 
            response_tracker = {
                prev_request: 0,
                prev_response: 100000, 
                last_request:  1000000,
                last_response: 10000000
            }
            await fs.writeFile(path.join(__dirname,"last_response.json"), JSON.stringify(response_tracker));
        }
    }
}