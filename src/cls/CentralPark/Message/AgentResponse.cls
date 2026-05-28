/// Outbound response from the triage agent.
///
/// Body is the agent's JSON-encoded result. The schema is:
///   {
///     "level": "self-care" | "see-gp" | "urgent-care" | "ed",
///     "summary": "...",
///     "citations": [{"source": "...", "snippet": "..."}],
///     "communication_id": "<FHIR Communication.id, if escalated>"
///   }
Class CentralPark.Message.AgentResponse Extends Ens.Response
{

Property Body As %String(MAXLEN = "");

Storage Default
{
<Type>%Storage.Persistent</Type>
}

}
