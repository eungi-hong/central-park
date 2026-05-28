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
  <Route Url="/health"  Method="GET"  Call="GetHealth"/>
  <Route Url="/triage"  Method="POST" Call="PostTriage"/>
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

}
