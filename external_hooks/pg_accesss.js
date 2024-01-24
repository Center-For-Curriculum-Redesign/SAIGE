await import('dotenv/config');
import pg from 'pg';
const { Pool } = pg;
import pgvector from 'pgvector/pg';


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
      let queryText = `SELECT c.text_content, c.page_number, a.issn, a.title, a.peerreviewed, c.identifiersgeo, a.article_id, a.referencecount, a.granularity, FROM articles AS a, chunks_`+granularity+` AS c WHERE c.article_id = a.article_id`+append;
      let queryParams = [pgvector.toSql(embedding), top_k];
      queryText += ` ORDER BY c.embedding <#> $1 LIMIT $2;`;

      queries.push({ text: queryText, values: queryParams });
    }
  }
  return queries;
}

const executeQueries = async (queries) => {
  const client = await pool.connect();
  try {
    let results = [];
    for (let query of queries) {
      const result = await client.query(query.text, query.values);
      results.append(result);
    }
    return results;
  } catch (error) {
    console.error('Database query error', error);
  } finally {
    client.release();
  }
}

export const getSimilarEmbeddings = async(embeddings_list, granularities_list, additionalFilters) => {
  const queries = buildEmbeddingSimQuery(embeddings_list, granularities_list, additionalFilters)
  const result = executeQueries(queries);
  return result;
}
