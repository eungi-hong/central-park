/// Inbound request to the triage agent.
Class CentralPark.Message.AgentRequest Extends Ens.Request
{

/// FHIR Patient resource id the agent should ground on.
Property PatientID As %String(MAXLEN = 64) [ Required ];

/// Free-text message from the patient.
Property Message As %String(MAXLEN = 4000) [ Required ];

/// Optional conversation id so future turns can be threaded.
Property ConversationID As %String(MAXLEN = 64);

Storage Default
{
<Type>%Storage.Persistent</Type>
}

}
