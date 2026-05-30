/// Storage class for triage guideline snippets. One row per snippet, with a
/// VECTOR column holding its OpenAI text-embedding-3-small embedding.
/// Populated by the agent-side seed (via CentralPark.REST.Dispatch's
/// /vector/seed route, which embeds in IRIS via %Embedding.OpenAI); queried
/// per turn by central_park.tools.vector through /vector/search.
Class CentralPark.Data.Guideline Extends %Persistent
{

/// Stable id of the snippet ("nhs-chest-pain-001"). Lets the seed route do
/// idempotent upserts without churning data on reseed.
Property Slug As %String(MAXLEN = 128) [ Required ];

/// Human-readable source label, displayed in citations.
Property Source As %String(MAXLEN = 256);

/// The snippet text the LLM sees.
Property Snippet As %String(MAXLEN = 4000);

/// 1536-dim embedding vector from OpenAI text-embedding-3-small.
/// Datatype is "float" (single precision) because that's what
/// %Embedding.OpenAI returns natively; declaring "double" would force a
/// type mismatch in VECTOR_COSINE between stored and query vectors.
Property Embedding As %Vector(DATATYPE = "float", LEN = 1536);

Index SlugIdx On Slug [ Unique ];

// NOTE: For larger corpora, add an HNSW vector index here. The image ships
// %SQL.Index.HNSW but its DDL parameter syntax in irishealth-community:latest-cd
// wouldn't compile cleanly during this iteration. With ~30 rows, full-table
// cosine search is sub-millisecond. Worth revisiting in iteration 4.

Storage Default
{
<Data name="GuidelineDefaultData">
<Value name="1"><Value>%%CLASSNAME</Value></Value>
<Value name="2"><Value>Slug</Value></Value>
<Value name="3"><Value>Source</Value></Value>
<Value name="4"><Value>Snippet</Value></Value>
<Value name="5"><Value>Embedding</Value></Value>
</Data>
<DataLocation>^CentralPark.Data.GuidelineD</DataLocation>
<DefaultData>GuidelineDefaultData</DefaultData>
<IdLocation>^CentralPark.Data.GuidelineD</IdLocation>
<IndexLocation>^CentralPark.Data.GuidelineI</IndexLocation>
<StreamLocation>^CentralPark.Data.GuidelineS</StreamLocation>
<Type>%Storage.Persistent</Type>
}

}
