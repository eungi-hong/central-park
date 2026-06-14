/// IntegratedML readmission/deterioration risk model.
///
/// Trains an IRIS IntegratedML (AutoML) model on a small synthetic cohort and
/// exposes a row-level PREDICT. The triage agent posts a patient's features
/// (age, comorbidity count, symptom severity) and gets back an elevated-risk
/// flag with a probability, which it folds into its reasoning.
///
/// Everything here is best-effort and idempotent: if AutoML is unavailable or
/// training fails, Setup() logs and returns, and Predict() reports the model as
/// unavailable so the agent degrades gracefully rather than erroring.
Class CentralPark.ML Extends %RegisteredObject
{

Parameter MODEL = "CentralParkRisk";

Parameter TABLE = "CentralPark_Data.RiskTraining";

/// Create the training table, seed it (once), and create + train the model.
/// Called from CentralPark.Install.Run at boot.
ClassMethod Setup() As %Status
{
    // Gated off by default. IRIS AutoML trains via Embedded Python, which is
    // unstable on this image's ARM64 build (the same reason the LangGraph agent
    // runs in a sidecar) and would HANG boot. Enable on x86 hosts with
    // CP_ENABLE_ML=1; when disabled the agent's risk tool simply reports the
    // model unavailable and triages without it.
    if ($system.Util.GetEnviron("CP_ENABLE_ML") '= "1") {
        write !,"ML risk model disabled (set CP_ENABLE_ML=1 to train; needs x86 Embedded Python)."
        quit $$$OK
    }
    set sc = $$$OK
    try {
        do ##class(%SQL.Statement).%ExecDirect(, "CREATE TABLE "_..#TABLE_" (Age INT, Comorbid INT, Severity INT, Readmit VARCHAR(5))")

        // Seed only when empty so a restart doesn't duplicate rows.
        set rs = ##class(%SQL.Statement).%ExecDirect(, "SELECT COUNT(*) cnt FROM "_..#TABLE)
        do rs.%Next()
        if (rs.%Get("cnt") = 0) {
            do ..Seed()
        }

        // Recreate the model so a reinstall retrains cleanly.
        do ##class(%SQL.Statement).%ExecDirect(, "DROP MODEL "_..#MODEL)
        set rs = ##class(%SQL.Statement).%ExecDirect(, "CREATE MODEL "_..#MODEL_" PREDICTING (Readmit) FROM "_..#TABLE)
        if (rs.%SQLCODE < 0) {
            write !,"CREATE MODEL: ",rs.%Message
        }
        set rs = ##class(%SQL.Statement).%ExecDirect(, "TRAIN MODEL "_..#MODEL)
        if (rs.%SQLCODE < 0) {
            write !,"TRAIN MODEL: ",rs.%Message
        } else {
            write !,"ML risk model trained."
        }
    } catch ex {
        write !,"ML setup failed (non-fatal): ",ex.DisplayString()
        set sc = ex.AsStatus()
    }
    quit sc
}

/// Insert a deterministic synthetic cohort. Risk rises with age, comorbidity
/// count, and symptom severity, so AutoML has a clean signal to learn.
ClassMethod Seed() As %Status
{
    set ins = ##class(%SQL.Statement).%New()
    do ins.%Prepare("INSERT INTO "_..#TABLE_" (Age,Comorbid,Severity,Readmit) VALUES (?,?,?,?)")
    for age = 40:5:85 {
        for comorbid = 0:1:4 {
            set severity = (comorbid * 2) + $select(age >= 65: 2, 1: 0) + 1
            if (severity > 10) {
                set severity = 10
            }
            set elevated = (((age >= 65) && (comorbid >= 2)) || (severity >= 8))
            set label = $select(elevated: "yes", 1: "no")
            do ins.%Execute(age, comorbid, severity, label)
        }
    }
    write !,"ML training cohort seeded."
    quit $$$OK
}

/// Predict elevated risk for one patient's features. Returns the predicted
/// label and probability by reference and a status; callers treat an error as
/// "model unavailable".
ClassMethod Predict(age As %Integer, comorbid As %Integer, severity As %Integer, ByRef pred As %String, ByRef prob As %Numeric) As %Status
{
    set pred = "", prob = "", sc = $$$OK
    try {
        // Predict over a one-row derived table of the supplied features.
        set sql = "SELECT PREDICT("_..#MODEL_") pred, PROBABILITY("_..#MODEL_" FOR 'yes') prob FROM (SELECT ? Age, ? Comorbid, ? Severity)"
        set rs = ##class(%SQL.Statement).%ExecDirect(, sql, age, comorbid, severity)
        if (rs.%SQLCODE < 0) {
            set sc = $$$ERROR($$$GeneralError, rs.%Message)
        } elseif rs.%Next() {
            set pred = rs.%Get("pred")
            set prob = rs.%Get("prob")
        } else {
            set sc = $$$ERROR($$$GeneralError, "no prediction row")
        }
    } catch ex {
        set sc = ex.AsStatus()
    }
    quit sc
}

}
