/// Central Park Interoperability production.
///
/// Holds the REST inbox business service and the triage agent business
/// operation. Everything in the request path is a first-class production
/// item, so future routers, alerters, and transformers can be wired in
/// without touching the REST surface or the agent itself.
Class CentralPark.Production Extends Ens.Production
{

XData ProductionDefinition
{
<Production Name="CentralPark.Production" LogGeneralTraceEvents="false" TestingEnabled="true">
  <ActorPoolSize>2</ActorPoolSize>

  <Item Name="REST Inbox"
        Category=""
        ClassName="CentralPark.Service.RESTInbox"
        PoolSize="0"
        Enabled="true"
        Foreground="false"
        Comment="In-process service spawned by CentralPark.REST.Dispatch. PoolSize 0 = no listener, on-demand only."
        LogTraceEvents="false"
        Schedule=""/>

  <Item Name="Triage Agent"
        Category=""
        ClassName="CentralPark.Operation.TriageAgent"
        PoolSize="1"
        Enabled="true"
        Foreground="false"
        Comment="LangGraph agent in the Python sidecar, called over HTTP."
        LogTraceEvents="false"
        Schedule="">
    <Setting Target="Adapter" Name="HTTPServer">agent</Setting>
    <Setting Target="Adapter" Name="HTTPPort">8000</Setting>
    <Setting Target="Adapter" Name="URL">/run</Setting>
    <!-- A llama3.2:3b cold-start on CPU can take 20-40s; first warm-call ~10s.
         FailureTimeout caps the operation's wait on the adapter and must
         exceed the slowest expected response. ResponseTimeout is the
         per-request HTTP socket timeout. -->
    <Setting Target="Host" Name="FailureTimeout">180</Setting>
    <Setting Target="Adapter" Name="ResponseTimeout">120</Setting>
  </Item>

</Production>
}

}
