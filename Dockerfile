# IRIS for Health Community Edition. Ships FHIR R4, Interoperability, and IPM.
# No license file needed. We no longer install Python deps here, because the
# LangGraph agent runs in a separate sidecar container (see agent/Dockerfile);
# IRIS just speaks HTTP to it via EnsLib.HTTP.OutboundAdapter.
ARG IMAGE=intersystemsdc/irishealth-community:latest-cd
FROM $IMAGE
USER root

WORKDIR /home/irisowner/central-park
COPY --chown=irisowner:irisowner . /home/irisowner/central-park

USER irisowner

# Boot-time setup: create the CENTRALPARK namespace, enable interop, load our
# classes, register the FHIR R4 endpoint and CSP REST app, auto-start the
# production. iris.script writes /tmp/centralpark.bootstrap.ok on success and
# the test below asserts it, so a silent failure fails the build.
RUN mkdir -p /usr/irissys/mgr/centralpark \
    && iris start IRIS \
    && iris session IRIS < /home/irisowner/central-park/iris-config/iris.script \
    && test -f /tmp/centralpark.bootstrap.ok \
    && iris stop IRIS quietly
