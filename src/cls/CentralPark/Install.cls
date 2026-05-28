/// Boot-time installer. Called from iris.script after classes are loaded
/// into the CENTRALPARK namespace. Lives in a compiled class because that's
/// the only way we get multi-line brace blocks and try/catch in this codebase,
/// since iris.script is parsed line by line.
Class CentralPark.Install Extends %RegisteredObject
{

Parameter NAMESPACE = "CENTRALPARK";
Parameter ENDPOINT = "/csp/healthshare/centralpark/fhir/r4";
Parameter STRATEGY = "HS.FHIRServer.Storage.Json.InteractionsStrategy";
Parameter METADATA = "HL7v40";
Parameter RESTAPP = "/centralpark";

ClassMethod Run() As %Status
{
    // Note: %EnsembleMgr.EnableNamespace auto-installs HealthShare Foundation
    // for IRIS for Health, so no explicit Foundation install step is needed.
    do ..InstallFHIRServer()
    do ..InstallRESTApp()
    do ..StartProduction()
    quit $$$OK
}

/// Create the FHIR R4 endpoint at ENDPOINT, backed by the JSON storage
/// strategy. Two steps: InstallNamespace registers FHIR metadata for the
/// current namespace; InstallInstance binds the URL to that namespace.
ClassMethod InstallFHIRServer()
{
    try {
        do ##class(HS.FHIRServer.Installer).InstallNamespace()
    } catch ex {
        write !,"InstallNamespace error: ",ex.DisplayString()
    }
    try {
        do ##class(HS.FHIRServer.Installer).InstallInstance(..#ENDPOINT, ..#STRATEGY, ..#METADATA)
        write !,"FHIR endpoint installed at ",..#ENDPOINT
    } catch ex {
        write !,"InstallInstance error: ",ex.DisplayString()
    }
}

/// Register /centralpark as a CSP application that dispatches to our REST
/// class. This is a %SYS-namespace operation, so we save/restore $namespace.
ClassMethod InstallRESTApp()
{
    set saveNS = $namespace
    try {
        set $namespace = "%SYS"
        set props("AutheEnabled") = 64                              // password auth
        set props("DispatchClass") = "CentralPark.REST.Dispatch"
        set props("NameSpace") = ..#NAMESPACE
        set props("MatchRoles") = ":%All"
        do ##class(Security.Applications).Create(..#RESTAPP, .props)
        write !,"REST app ",..#RESTAPP," registered."
    } catch ex {
        write !,"InstallRESTApp error: ",ex.DisplayString()
    }
    set $namespace = saveNS
}

/// Auto-start the production at boot and start it now.
ClassMethod StartProduction()
{
    try {
        do ##class(Ens.Director).SetAutoStart("CentralPark.Production")
        do ##class(Ens.Director).StartProduction("CentralPark.Production")
        write !,"Production started."
    } catch ex {
        write !,"StartProduction error: ",ex.DisplayString()
    }
}

}
