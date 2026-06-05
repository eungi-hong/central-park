#!/bin/sh
set -eu

# Defaults match docker-compose service DNS. Override via the ui service env.
: "${CP_AGENT_BASE_URL:=http://agent:8000}"
: "${CP_FHIR_BASE_URL:=http://iris:52773/csp/healthshare/centralpark/fhir/r4}"
: "${CP_FHIR_USER:=_SYSTEM}"
: "${CP_FHIR_PASSWORD:=SYS}"

# Base64 the FHIR basic-auth credential server-side (tr -d '\n' guards against
# base64 line-wrapping, which would corrupt the header value).
FHIR_B64="$(printf '%s:%s' "$CP_FHIR_USER" "$CP_FHIR_PASSWORD" | base64 | tr -d '\n')"
export CP_AGENT_BASE_URL CP_FHIR_BASE_URL FHIR_B64

# Render only our tokens; leave nginx's own $variables intact.
envsubst '${CP_AGENT_BASE_URL} ${CP_FHIR_BASE_URL} ${FHIR_B64}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
