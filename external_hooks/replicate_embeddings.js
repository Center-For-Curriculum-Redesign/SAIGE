import Replicate from "replicate";
import fss from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const replicate = new Replicate({
    auth: ""+process.env.REPLICATE_API_TOKEN
});

/**returns an esitmate of how long until the embedding endpoint becomes available*/
export const getETA = async () => {
    let response_tracker = JSON.parse(fss.readFileSync(path.join(__dirname,"last_response.json"), 'utf8'));
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
    heartbeatEmbedding(()=>updateRsponseTracker(response_tracker));
    return ETA;
}

const updateRsponseTracker = async (prior_tracker) => {
    prior_tracker.prev_request = prior_tracker.last_request;
    prior_tracker.prev_response = prior_tracker.last_response;
    prior_tracker.last_response = Date.now();  
    fs.writeFile(path.join(__dirname,"last_response.json"), JSON.stringify(prior_tracker));
}

export const heartbeatEmbedding = async (oncomplete) => {    
    await queryEmbRequest(['heartbeat']); 
    oncomplete()
}

export const getEmbeddings = async  (queries, granularities) => {
    let results = {}
    console.log("chromadb call for " +stringEmbs.length + " queries")
    stringEmbs = [...await queryEmbRequest(queries)]
    for(let k in granularities) {
        let from_collection = collection_map[k];                    
        results[k] = await from_collection.query(
            {queryEmbeddings: stringEmbs, 
            nResults: granularities[k]});
        console.log("call complete")
    }
    results.queryEmbeddings = stringEmbs;
    let asJSON = JSON.stringify(results);
    //console.log(await resultfile.json())
    return new Response(asJSON,  {headers: {
        "Content-Type": "application/json",
    }});
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