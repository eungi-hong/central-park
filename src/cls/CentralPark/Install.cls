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
Parameter SSLCONFIG = "openai-ssl";
Parameter EMBEDDINGCONFIG = "central-park-openai";

ClassMethod Run() As %Status
{
    // Note: %EnsembleMgr.EnableNamespace auto-installs HealthShare Foundation
    // for IRIS for Health, so no explicit Foundation install step is needed.
    do ..InstallFHIRServer()
    do ..InstallRESTApp()
    do ..InstallSSLConfig()
    do ..InstallEmbeddingConfig()
    do ..SeedFHIR()
    do ..StartProduction()
    quit $$$OK
}

/// Create an outbound TLS configuration named "openai-ssl" so
/// %Embedding.OpenAI can reach api.openai.com. We use VerifyPeer=0 (no peer
/// verification) for a frictionless demo; for production use, configure a CA
/// bundle and set VerifyPeer=2.
ClassMethod InstallSSLConfig()
{
    set saveNS = $namespace
    try {
        set $namespace = "%SYS"
        if ##class(Security.SSLConfigs).Exists(..#SSLCONFIG) {
            write !,"SSL config ",..#SSLCONFIG," already exists."
        } else {
            set props("Description") = "Outbound TLS for OpenAI API"
            set props("VerifyPeer") = 0
            set props("Protocols") = 24 // TLS 1.2
            set sc = ##class(Security.SSLConfigs).Create(..#SSLCONFIG, .props)
            if 'sc {
                write !,"SSL config create failed: ",$system.Status.GetErrorText(sc)
            } else {
                write !,"SSL config ",..#SSLCONFIG," created."
            }
        }
    } catch ex {
        write !,"InstallSSLConfig error: ",ex.DisplayString()
    }
    set $namespace = saveNS
}

/// Create the named %Embedding.Config row that PostVectorSeed and
/// PostVectorSearch use to call OpenAI's embedding API natively from
/// ObjectScript. The key is read from OPENAI_API_KEY at call time, so this
/// can be re-invoked at runtime to pick up keys set in .env after image
/// build. Returns %Status. Logs go to ^CentralPark("log","install") so
/// callers that route through HTTP don't get write-bleed into the response.
ClassMethod InstallEmbeddingConfig() As %Status
{
    set sc = $$$OK
    try {
        set apiKey = $system.Util.GetEnviron("OPENAI_API_KEY")

        if ##class(%Embedding.Config).%ExistsId(..#EMBEDDINGCONFIG) {
            do ##class(%Embedding.Config).%DeleteId(..#EMBEDDINGCONFIG)
        }

        set jsonCfg = {}
        set jsonCfg."modelName" = "text-embedding-3-small"
        set jsonCfg."apiKey" = apiKey
        set jsonCfg."sslConfig" = ..#SSLCONFIG
        set jsonCfg."checkTokenCount" = 0

        set cfg = ##class(%Embedding.Config).%New()
        set cfg.Name = ..#EMBEDDINGCONFIG
        set cfg.Description = "OpenAI text-embedding-3-small via AI Hub native provider"
        set cfg.EmbeddingClass = "%Embedding.OpenAI"
        set cfg.Configuration = jsonCfg.%ToJSON()
        set cfg.VectorLength = 1536
        set sc = cfg.%Save()
        set ^CentralPark("log","install","embedding-config") = $listbuild($zdatetime($horolog, 3), (apiKey '= ""), $select(sc: "ok", 1: $system.Status.GetErrorText(sc)))
    } catch ex {
        set ^CentralPark("log","install","embedding-config") = $listbuild($zdatetime($horolog, 3), 0, ex.DisplayString())
        set sc = ex.AsStatus()
    }
    quit sc
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

/// Load the demo patient bundle into the FHIR endpoint. Idempotent: a global
/// marker (^CentralPark("seed", "demo-patient-1")) lets repeated boots skip
/// the POST. The bundle itself uses PUT requests on stable ids, so a manual
/// re-seed is safe too.
ClassMethod SeedFHIR()
{
    if $get(^CentralPark("seed", "demo-patient-1")) {
        write !,"FHIR seed already loaded, skipping."
        quit
    }
    try {
        set bundlePath = "/home/irisowner/central-park/iris-config/seed/demo-patient-1.json"
        if '##class(%File).Exists(bundlePath) {
            write !,"Seed bundle not found at ",bundlePath
            quit
        }
        set stream = ##class(%Stream.FileBinary).%New()
        do stream.LinkToFile(bundlePath)
        set req = ##class(%Net.HttpRequest).%New()
        set req.Server = "localhost"
        set req.Port = 52773
        set req.Username = "_SYSTEM"
        set req.Password = "SYS"
        set req.ContentType = "application/fhir+json"
        do req.SetHeader("Accept", "application/fhir+json")
        do req.EntityBody.CopyFrom(stream)
        set sc = req.Post(..#ENDPOINT)
        if 'sc {
            write !,"Seed POST failed: ",$system.Status.GetErrorText(sc)
            quit
        }
        set status = req.HttpResponse.StatusCode
        write !,"Seed POST status=",status
        if (status = 200) || (status = 201) {
            set ^CentralPark("seed", "demo-patient-1") = $zdatetime($horolog, 3)
            write !," (marked seeded)"
        }
    } catch ex {
        write !,"Seed error: ",ex.DisplayString()
    }
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
