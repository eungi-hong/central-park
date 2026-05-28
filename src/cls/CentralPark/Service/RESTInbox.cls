/// In-process business service spawned by CentralPark.REST.Dispatch.
///
/// Adapter is empty because there is no listener. The REST class creates an
/// instance via Ens.Director.CreateBusinessService and calls SendRequestSync
/// directly. Keeping a real BS in the path means the production graph stays
/// honest: every agent invocation is visible in Visual Trace.
Class CentralPark.Service.RESTInbox Extends Ens.BusinessService
{

Parameter ADAPTER;

Method OnProcessInput(pInput As %RegisteredObject, Output pOutput As %RegisteredObject) As %Status
{
    // Unused: this service is driven by external callers using SendRequestSync,
    // not by an adapter polling for input. Kept to satisfy the interface.
    quit $$$OK
}

}
