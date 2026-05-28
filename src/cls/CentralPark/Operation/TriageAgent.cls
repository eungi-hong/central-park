/// Business operation that calls the Python sidecar over HTTP.
///
/// The agent itself runs in a separate FastAPI container (see agent/Dockerfile
/// and src/python/central_park/main.py). This class is the seam: it accepts a
/// CentralPark.Message.AgentRequest from the production graph, marshals it to
/// JSON, POSTs to the sidecar's /run, and returns the response.
///
/// The HTTP target is configured via the EnsLib.HTTP.OutboundAdapter settings
/// on the production item (HTTPServer, HTTPPort, URL).
Class CentralPark.Operation.TriageAgent Extends Ens.BusinessOperation
{

Parameter ADAPTER = "EnsLib.HTTP.OutboundAdapter";

Parameter INVOCATION = "Queue";

Property Adapter As EnsLib.HTTP.OutboundAdapter;

Method OnMessage(pRequest As CentralPark.Message.AgentRequest, Output pResponse As CentralPark.Message.AgentResponse) As %Status
{
    set pResponse = ##class(CentralPark.Message.AgentResponse).%New()

    // Marshal request to JSON.
    set body = {}
    set body."patient_id" = pRequest.PatientID
    set body."message" = pRequest.Message
    set body."conversation_id" = pRequest.ConversationID
    set jsonBody = body.%ToJSON()

    // Build an HTTP request with a JSON entity body, hand it to the adapter.
    set httpReq = ##class(%Net.HttpRequest).%New()
    set httpReq.ContentType = "application/json"
    do httpReq.EntityBody.Write(jsonBody)

    set tSC = ..Adapter.SendFormDataArray(.httpResp, "POST", httpReq, , , ..Adapter.URL)
    if $$$ISERR(tSC) quit tSC

    // Read response body.
    set respBody = ""
    if $isobject(httpResp.Data) {
        while 'httpResp.Data.AtEnd {
            set respBody = respBody _ httpResp.Data.Read(32000)
        }
    }
    set pResponse.Body = respBody
    quit $$$OK
}

XData MessageMap
{
<MapItems>
  <MapItem MessageType="CentralPark.Message.AgentRequest">
    <Method>OnMessage</Method>
  </MapItem>
</MapItems>
}

}
