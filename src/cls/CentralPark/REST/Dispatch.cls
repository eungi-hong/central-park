/// REST surface for Central Park.
///
/// Mounted at /centralpark by iris.script (and again by module.xml when
/// installed via IPM). Routes:
///
///   GET  /centralpark/health         liveness probe
///   POST /centralpark/triage         { patient_id, message } -> agent response
Class CentralPark.REST.Dispatch Extends %CSP.REST
{

Parameter HandleCorsRequest = 1;

Parameter CONTENTTYPE = "application/json";

XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <Route Url="/health"                    Method="GET"  Call="GetHealth"/>
  <Route Url="/triage"                    Method="POST" Call="PostTriage"/>
  <Route Url="/vector/seed"               Method="POST" Call="PostVectorSeed"/>
  <Route Url="/vector/search"             Method="POST" Call="PostVectorSearch"/>
  <Route Url="/install/embedding-config"  Method="POST" Call="PostInstallEmbeddingConfig"/>
  <Route Url="/risk/predict"              Method="POST" Call="PostRiskPredict"/>
</Routes>
}

ClassMethod GetHealth() As %Status
{
    set %response.ContentType = "application/json"
    write "{""status"":""ok"",""service"":""central-park""}"
    quit $$$OK
}

ClassMethod PostTriage() As %Status
{
    set %response.ContentType = "application/json"

    // Parse the inbound body.
    set tBody = {}.%FromJSON(%request.Content)
    set tReq = ##class(CentralPark.Message.AgentRequest).%New()
    set tReq.PatientID = tBody.%Get("patient_id")
    set tReq.Message = tBody.%Get("message")
    set tReq.ConversationID = tBody.%Get("conversation_id")

    // Spawn the in-process business service and dispatch synchronously.
    // SendRequestSync flows through Ens.MessageHeader, so the call shows up in
    // Visual Trace just like an externally-triggered message.
    set tSC = ##class(Ens.Director).CreateBusinessService("REST Inbox", .tSvc)
    if $$$ISERR(tSC) {
        set %response.Status = ..#HTTP500INTERNALSERVERERROR
        write "{""error"":""service_create_failed"",""detail"":"_$$$quote($system.Status.GetErrorText(tSC))_"}"
        quit $$$OK
    }

    set tSC = tSvc.SendRequestSync("Triage Agent", tReq, .tResp)
    if $$$ISERR(tSC) {
        set %response.Status = ..#HTTP500INTERNALSERVERERROR
        write "{""error"":""dispatch_failed"",""detail"":"_$$$quote($system.Status.GetErrorText(tSC))_"}"
        quit $$$OK
    }

    // tResp.Body is already JSON from the Python agent.
    write tResp.Body
    quit $$$OK
}

/// IntegratedML risk prediction. Body is { "age", "comorbid", "severity" }.
/// Returns { available, elevated_risk, prediction, probability }. If the model
/// is not trained (e.g. AutoML unavailable), returns { "available": 0 } so the
/// agent degrades gracefully.
ClassMethod PostRiskPredict() As %Status
{
    set %response.ContentType = "application/json"
    set body = {}.%FromJSON(%request.Content)
    set age = +body.%Get("age")
    set comorbid = +body.%Get("comorbid")
    set severity = +body.%Get("severity")
    set out = {}
    set sc = ##class(CentralPark.ML).Predict(age, comorbid, severity, .pred, .prob)
    if $$$ISOK(sc) {
        set out.available = 1
        set out.prediction = pred
        set out."elevated_risk" = $select(pred = "yes": 1, 1: 0)
        set out.probability = prob
    } else {
        set out.available = 0
        set out.error = $system.Status.GetErrorText(sc)
    }
    write out.%ToJSON()
    quit $$$OK
}

/// Load the named %Embedding.Config row and return its Configuration JSON,
/// suitable to pass as the second argument to %Embedding.OpenAI.Embedding.
ClassMethod GetEmbedConfigJson() As %String [ Private ]
{
    set cfg = ##class(%Embedding.Config).%OpenId("central-park-openai")
    if '$isobject(cfg) quit ""
    quit cfg.Configuration
}

/// Rebuild the %Embedding.Config row from the current OPENAI_API_KEY env var.
/// The agent sidecar POSTs this at startup so the key set in .env (which is
/// runtime, after image build) reaches the config row that
/// %Embedding.OpenAI looks up.
ClassMethod PostInstallEmbeddingConfig() As %Status
{
    set %response.ContentType = "application/json"
    set sc = ##class(CentralPark.Install).InstallEmbeddingConfig()
    set hasKey = ($system.Util.GetEnviron("OPENAI_API_KEY") '= "")
    set out = {}
    set out.ok = $$$ISOK(sc)
    set out."hasKey" = hasKey
    if 'sc set out.error = $system.Status.GetErrorText(sc)
    write out.%ToJSON()
    quit $$$OK
}

/// Upsert guideline rows. Body is a JSON array of { "slug", "source", "snippet" }.
/// IRIS embeds each snippet via %Embedding.OpenAI using the named
/// "central-park-openai" %Embedding.Config row, then inserts or updates.
/// Existing rows with the same slug are updated, new ones inserted.
ClassMethod PostVectorSeed() As %Status
{
    set %response.ContentType = "application/json"
    set tArr = [].%FromJSON(%request.Content)
    set inserted = 0, updated = 0, errors = 0
    set iter = tArr.%GetIterator()
    while iter.%GetNext(.key, .row) {
        set slug = row.%Get("slug")
        set source = row.%Get("source")
        set snippet = row.%Get("snippet")
        try {
            set vec = ##class(%Embedding.OpenAI).Embedding(snippet, ..GetEmbedConfigJson())
        } catch ex {
            set errors = errors + 1
            continue
        }
        // Try update first, fall back to insert. The vector binds directly
        // (no TO_VECTOR string round-trip needed when passing a %Vector).
        set rs = ##class(%SQL.Statement).%ExecDirect(,
            "UPDATE CentralPark_Data.Guideline SET Source=?, Snippet=?, Embedding=? WHERE Slug=?",
            source, snippet, vec, slug)
        if rs.%ROWCOUNT > 0 {
            set updated = updated + 1
        } else {
            set rs = ##class(%SQL.Statement).%ExecDirect(,
                "INSERT INTO CentralPark_Data.Guideline (Slug, Source, Snippet, Embedding) VALUES (?, ?, ?, ?)",
                slug, source, snippet, vec)
            if rs.%SQLCODE = 0 set inserted = inserted + 1
        }
    }
    set out = {}
    set out.inserted = inserted
    set out.updated = updated
    set out.errors = errors
    write out.%ToJSON()
    quit $$$OK
}

/// Top-k cosine search over the guideline corpus. Body is
/// { "query": "<text>", "k": int }.
/// IRIS embeds the query via %Embedding.OpenAI, then runs VECTOR_COSINE
/// (HNSW-indexed). Response is { "hits": [{slug, source, snippet, score}, ...] }.
ClassMethod PostVectorSearch() As %Status
{
    set %response.ContentType = "application/json"
    set tBody = {}.%FromJSON(%request.Content)
    set query = tBody.%Get("query")
    set k = +$select(tBody.%Get("k")="": 5, 1: tBody.%Get("k"))
    try {
        set queryVec = ##class(%Embedding.OpenAI).Embedding(query, ..GetEmbedConfigJson())
    } catch ex {
        set %response.Status = ..#HTTP500INTERNALSERVERERROR
        write "{""error"":""embedding_failed"",""detail"":"_$$$quote(ex.DisplayString())_"}"
        return $$$OK
    }
    set sql = "SELECT TOP ? Slug, Source, Snippet, VECTOR_COSINE(Embedding, ?) AS Score FROM CentralPark_Data.Guideline ORDER BY Score DESC"
    set rs = ##class(%SQL.Statement).%ExecDirect(, sql, k, queryVec)
    set hits = []
    while rs.%Next() {
        set row = {}
        set row.slug = rs.Slug
        set row.source = rs.Source
        set row.snippet = rs.Snippet
        set row.score = rs.Score
        do hits.%Push(row)
    }
    set out = {}
    set out.hits = hits
    write out.%ToJSON()
    quit $$$OK
}

}
