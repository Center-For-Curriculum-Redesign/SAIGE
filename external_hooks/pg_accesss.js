await import('dotenv/config');
import pg from 'pg';
const { Pool } = pg;
import pgvector from 'pgvector/pg';
import { doFetchPost, endpoints_available } from '../textstream.js';


const pool = new Pool({
  user: process.env.pg_auth_user,
  host: process.env.pg_auth_host,
  database: process.env.pg_auth_db,
  port: process.env.pg_auth_port,
});


const buildEmbeddingSimQuery = async (embeddings_list, granularities_obj, additionalFilter) => {
  let queries = [];
  let append = additionalFilter == null ? "" : " AND ";

  for (let embedding of embeddings_list) {
    for (let [granularity, top_k] of Object.entries(granularities_obj)) {
      let queryText = `SELECT c.text_content, c.page_number, a.issn, a.title, a.peerreviewed, c.chunk_number, c.identifiersgeo, a.article_id, a.referencecount, c.publisher, c.publicationdateyear, c.publicationdatemonth, c.granularity, (c.embedding <#> $1) * -1 AS distance FROM articles AS a, chunks_`+granularity+` AS c WHERE c.article_id = a.article_id`+append;
      let queryParams = [pgvector.toSql(embedding), top_k];
      queryText += ` ORDER BY c.embedding <#> $1 LIMIT $2;`;

      queries.push({ text: queryText, values: queryParams });
    }
  }
  return queries;
}

const executeMultipleQueries = async (queries) => {
  if(!Array.isArray(queries)) {
    throw new Error("queries parameter must be an array. Use executeQuery if you want to run a single query");
  }
  const client = await pool.connect();
  try {
    let results = [];
    for (let query of queries) {
      const result = await client.query(query.text, query.values);
      results.push(result)
    }
    return results;
  } catch (error) {
    console.error('Database query error', error);
  } finally {
    client.release(); 
  } 
}

const executeQuery = async (query) => {
  let results = await executeMultipleQueries([query]);
  return results[0];
}

export const _localgetSimilarEmbeddings = async(embeddings_list, granularities_list, additionalFilters) => {
  const queries = await buildEmbeddingSimQuery(embeddings_list, granularities_list, additionalFilters)
  const results = await executeMultipleQueries(queries);
  let groupedResults = {}
  for(let resultObj of results) {
    if(resultObj.rows.length > 0) {
      groupedResults[resultObj.rows[0]['granularity']] = resultObj.rows;
      for(let r of resultObj.rows) {
        r.page_number_start = r.page_number;
        r.page_number_end = r.page_number;
      }
    }
  }
  return groupedResults;
}

export const _localExpandChunk = async (inputChunk, n_before=1, n_after=1) => {
  let chunk_number_start = inputChunk.chunk_number_start ? inputChunk.chunk_number_start : inputChunk.chunk_number;
  chunk_number_start = Math.max(0, chunk_number_start-n_before); 
  let chunk_number_end = inputChunk.chunk_number_end ? inputChunk.chunk_number_end : inputChunk.chunk_number;
  chunk_number_end = chunk_number_end+n_after;
  let article_id = inputChunk.article_id;
  let granularity = inputChunk.granularity;
  let queryText = `SELECT c.text_content, c.page_number, a.issn, a.title, a.peerreviewed, c.chunk_number, c.publisher, c.identifiersgeo, a.article_id, a.referencecount, c.granularity FROM articles AS a, chunks_`+granularity+` AS c WHERE c.article_id = a.article_id and a.article_id = $1 and chunk_number >= $2 and chunk_number <= $3`;
  let queryParams = [article_id, chunk_number_start, chunk_number_end];
  let chunkResults = [];  
  chunkResults = await executeQuery({text: queryText, values: queryParams });
  chunkResults = chunkResults.rows;  
  let mergedString = ''; 
  let min_page = 99999;
  let max_page = 0;
  for(let row of chunkResults) { 
    mergedString = mergeOverlappingStrings(mergedString, row.text_content);
    min_page = Math.min(min_page, row.page_number);
    max_page = Math.max(max_page, row.page_number);
  }
  let result = inputChunk;
  result.text_content = mergedString;
  result.chunk_number_start = chunk_number_start;
  result.chunk_number_end = chunk_number_end;
  result.page_number_start = min_page;
  result.page_number_end = max_page;
  result.expansion_count = inputChunk.expansion_count == null ? 1 : inputChunk.expansion_count+1; 
  return result; 
}

export const getSimilarEmbeddings = async(embeddings_list, granularities_list, additional_filters=null) => {
  const vec_db = endpoints_available['vec_db'][0];
  return await doFetchPost(vec_db+"/get_similarity", {'embeddings_list': embeddings_list,'granularities_list': granularities_list, 'additional_filters': additional_filters})
}


export const expandChunk = async(input_chunk, n_before, n_after) => {
  const vec_db = endpoints_available['vec_db'][0];
  let expandedResult = await doFetchPost(vec_db+'/expand_chunk', {
    input_chunk: input_chunk, n_before: n_before, n_after:n_after
  });
  return expandedResult; 
}


function mergeOverlappingStrings(str1, str2) {
  let overlapIndex = -1;
  for (let i = 0; i < str1.length; i++) {
      if (str2.startsWith(str1.substring(i))) {
          overlapIndex = i;
          break;
      }
  }
  if (overlapIndex === -1) {
      return str1+str2;
  }
  return str1.substring(0, overlapIndex) + str2;
}