library(shiny)

data_pack_id <- "clinical-demo-subject-profile-v1"
demographics <- read.csv("data/demographics.csv", stringsAsFactors = FALSE)
visits <- read.csv("data/visits.csv", stringsAsFactors = FALSE)
labs <- read.csv("data/labs.csv", stringsAsFactors = FALSE)
vitals <- read.csv("data/vitals.csv", stringsAsFactors = FALSE)
adverse_events <- read.csv("data/adverse_events.csv", stringsAsFactors = FALSE)
concomitant_meds <- read.csv("data/concomitant_meds.csv", stringsAsFactors = FALSE)
exposure <- read.csv("data/exposure.csv", stringsAsFactors = FALSE)

primary_subject <- "SUBJ-001"

subject_rows <- function(data, subject_id) {
  data[data$subject_id == subject_id, , drop = FALSE]
}

format_day <- function(value) {
  ifelse(is.na(value) | value == "", "ongoing", paste0("Day ", value))
}

first_or_na <- function(value) {
  if (length(value) == 0 || is.na(value[1]) || value[1] == "") {
    "n/a"
  } else {
    value[1]
  }
}

max_severity <- function(rows) {
  if (nrow(rows) == 0) {
    return("n/a")
  }
  severity_rank <- c(Mild = 1, Moderate = 2, Severe = 3)
  ranked <- severity_rank[rows$severity]
  if (all(is.na(ranked))) {
    return("n/a")
  }
  names(ranked)[which.max(ranked)]
}

count_related <- function(rows) {
  sum(rows$related %in% c("Possible", "Probable", "Related"))
}

count_abnormal_labs <- function(rows) {
  sum(rows$flag != "Normal")
}

build_subject_snapshot <- function(profile, visits, aes, labs, exposure_rows) {
  data.frame(
    Section = c(
      "Identity", "Identity", "Identity", "Study conduct", "Study conduct",
      "Exposure", "Exposure", "Safety", "Safety", "Safety", "Laboratory"
    ),
    Item = c(
      "Subject", "Site / Region", "Demographics", "Current status", "Latest visit",
      "Cycles observed", "Dose status", "AE count", "Serious AE count", "Maximum severity",
      "Abnormal lab records"
    ),
    Value = c(
      first_or_na(profile$subject_id),
      paste(first_or_na(profile$site_id), first_or_na(profile$region), sep = " / "),
      paste(first_or_na(profile$sex), paste0(first_or_na(profile$age), " years"), first_or_na(profile$race), sep = " / "),
      first_or_na(profile$study_status),
      first_or_na(tail(visits$visit, 1)),
      nrow(exposure_rows),
      paste(unique(exposure_rows$dose_status), collapse = ", "),
      nrow(aes),
      sum(aes$serious == "Y"),
      max_severity(aes),
      count_abnormal_labs(labs)
    ),
    check.names = FALSE
  )
}

build_safety_review <- function(aes, labs, exposure_rows) {
  alt_rows <- labs[labs$lab_test == "ALT", , drop = FALSE]
  high_alt <- alt_rows[alt_rows$flag != "Normal", , drop = FALSE]
  reduced_dose <- exposure_rows[exposure_rows$dose_status %in% c("Dose reduced", "Interrupted"), , drop = FALSE]
  serious_count <- sum(aes$serious == "Y")
  related_count <- count_related(aes)

  data.frame(
    Review_Item = c(
      "Serious adverse events",
      "Treatment-related adverse events",
      "Maximum AE severity",
      "ALT abnormality",
      "Dose modification"
    ),
    Finding = c(
      paste(serious_count, "serious event(s)"),
      paste(related_count, "possibly/probably/related event(s)"),
      max_severity(aes),
      if (nrow(high_alt) == 0) "No abnormal ALT records" else paste(nrow(high_alt), "high ALT record(s)"),
      if (nrow(reduced_dose) == 0) "No dose reduction/interruption" else paste(reduced_dose$cycle, reduced_dose$dose_status, collapse = "; ")
    ),
    Evidence = c(
      if (serious_count == 0) "AE listing" else paste(aes$ae_id[aes$serious == "Y"], collapse = ", "),
      if (related_count == 0) "AE listing" else paste(aes$ae_id[aes$related %in% c("Possible", "Probable", "Related")], collapse = ", "),
      if (nrow(aes) == 0) "No AE records" else paste(aes$ae_id, aes$severity, collapse = "; "),
      if (nrow(high_alt) == 0) "Lab listing" else paste(high_alt$visit, high_alt$lab_value, high_alt$unit, collapse = "; "),
      if (nrow(reduced_dose) == 0) "Exposure listing" else paste("Cycle", reduced_dose$cycle, reduced_dose$dose_intensity_pct, "%", collapse = "; ")
    ),
    Review_Status = c(
      if (serious_count > 0) "Medical review" else "No SAE signal",
      if (related_count > 0) "Causality review" else "No related AE",
      if (max_severity(aes) %in% c("Severe")) "Priority review" else "Routine review",
      if (nrow(high_alt) > 0) "Lab follow-up" else "No lab flag",
      if (nrow(reduced_dose) > 0) "Dose review" else "No action"
    ),
    check.names = FALSE
  )
}

profile_css <- "
  body { background: #f5f7f8; color: #17212b; }
  .eyebrow { color: #496675; font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
  .profile-header { align-items: flex-end; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 16px; }
  .selector { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; padding: 12px; min-width: 280px; }
  .hash-line { border-top: 1px solid #edf1f3; color: #526b79; display: grid; gap: 4px; font-size: 12px; font-weight: 800; margin-top: 10px; padding-top: 10px; }
  .hash-line code { color: #101820; font-size: 11px; overflow-wrap: anywhere; white-space: normal; }
  .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
  .metric { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; padding: 14px; }
  .metric span { color: #526b79; display: block; font-size: 12px; font-weight: 800; margin-bottom: 8px; }
  .metric strong { color: #101820; font-size: 24px; line-height: 1; overflow-wrap: anywhere; }
  .profile-check { background: #e7f4ee; border: 1px solid #a9d6c4; border-radius: 8px; color: #0d6b4f; font-size: 13px; font-weight: 800; margin-bottom: 14px; padding: 10px 12px; }
  .section-card { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; margin-top: 14px; padding: 16px; }
  .control-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 12px; }
  .ae-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
  .ae-chip { background: #eef5f7; border: 1px solid #c8d9df; border-radius: 999px; color: #21313a; font-size: 12px; font-weight: 800; padding: 6px 10px; }
  .timeline-list { display: grid; gap: 8px; }
  .timeline-row { align-items: center; border-bottom: 1px solid #edf1f3; display: grid; gap: 10px; grid-template-columns: 80px 1fr 130px; padding: 8px 0; }
  .timeline-row strong { color: #101820; }
  .timeline-row span { color: #526b79; font-size: 13px; }
  .data-note { color: #526b79; font-size: 12px; font-weight: 700; margin-top: 8px; }
  .report-intro { align-items: center; display: flex; gap: 12px; justify-content: space-between; margin: 0 0 12px; }
  .report-page { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; margin-top: 14px; padding: 18px; }
  .report-title { align-items: flex-start; border-bottom: 1px solid #edf1f3; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 14px; padding-bottom: 12px; }
  .report-title h2 { margin: 0 0 4px; }
  .report-title p { color: #526b79; font-size: 13px; font-weight: 700; margin: 0; }
  .report-meta { color: #526b79; font-size: 12px; font-weight: 800; text-align: right; }
  .report-grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 12px 0 16px; }
  .report-kpi { background: #f7fafb; border: 1px solid #d7dee3; border-radius: 8px; padding: 12px; }
  .report-kpi span { color: #526b79; display: block; font-size: 12px; font-weight: 800; margin-bottom: 6px; }
  .report-kpi strong { color: #101820; display: block; font-size: 20px; line-height: 1.15; }
  .report-narrative { background: #f2f7f4; border: 1px solid #bfd9cb; border-radius: 8px; color: #17392d; font-size: 14px; font-weight: 700; line-height: 1.55; margin: 12px 0; padding: 12px; }
  .report-warning { background: #fff7ed; border: 1px solid #f0c997; border-radius: 8px; color: #77420f; font-size: 12px; font-weight: 800; margin: 12px 0; padding: 10px 12px; }
  .report-stack { display: grid; gap: 14px; }
  .listing-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .listing-panel { border: 1px solid #edf1f3; border-radius: 8px; padding: 12px; }
  .listing-panel h3 { font-size: 16px; margin: 0 0 8px; }
  .table-note { color: #526b79; font-size: 12px; font-weight: 700; margin-top: 8px; }
  .print-hint { color: #526b79; font-size: 12px; font-weight: 800; }
  @media (max-width: 860px) {
    .profile-header { align-items: stretch; flex-direction: column; }
    .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .report-intro { align-items: stretch; flex-direction: column; }
    .report-title { flex-direction: column; }
    .report-meta { text-align: left; }
    .report-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .listing-grid { grid-template-columns: 1fr; }
    .timeline-row { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; }
    .profile-header, .nav, .tabbable > .nav-tabs, .selector { display: none !important; }
    .section-card, .report-page { border: 1px solid #cfd8de; break-inside: avoid; box-shadow: none; }
    .report-page { margin-top: 0; }
  }
"

ui <- fluidPage(
  tags$head(
    tags$style(HTML(profile_css)),
    tags$script(src = "harness-diagnostics.js")
  ),
  div(
    class = "profile-header",
    div(
      div(class = "eyebrow", "Synthetic clinical reference app"),
      h1("Subject Profile Reference App"),
      p("Overview, Timeline, Labs, AEs, and Meds from a fully synthetic data pack.")
    ),
    div(
      class = "selector",
      selectInput("subject_id", "Subject", choices = demographics$subject_id, selected = primary_subject),
      div(
        class = "hash-line",
        span("Data pack"),
        code(data_pack_id),
        span("Data pack hash"),
        code(id = "data_pack_hash_value", `data-harness-status` = "pending", "pending harness manifest")
      )
    )
  ),
  div(class = "profile-check", textOutput("profile_check", inline = TRUE)),
  div(
    class = "metric-grid",
    div(class = "metric", span("Subject"), strong(textOutput("subject_metric", inline = TRUE))),
    div(class = "metric", span("Arm"), strong(textOutput("arm_metric", inline = TRUE))),
    div(class = "metric", span("AE count"), strong(textOutput("ae_metric", inline = TRUE))),
    div(class = "metric", span("Latest visit"), strong(textOutput("visit_metric", inline = TRUE)))
  ),
  tabsetPanel(
    tabPanel(
      "Overview",
      div(
        class = "section-card",
        h2("Profile summary"),
        tableOutput("profile_table")
      ),
      div(
        class = "section-card",
        h2("ALT trend"),
        plotOutput("overview_lab_trend", height = "230px"),
        div(class = "data-note", "Lab trend: ALT")
      ),
      div(
        class = "section-card",
        h2("Recent vitals"),
        tableOutput("vitals_table")
      )
    ),
    tabPanel(
      "Timeline",
      div(
        class = "section-card",
        h2("Visit timeline"),
        uiOutput("timeline")
      ),
      div(
        class = "section-card",
        h2("Exposure and AE timeline"),
        plotOutput("exposure_ae_timeline", height = "280px"),
        div(class = "data-note", "Exposure intervals are shown with adverse events on the same study-day axis.")
      )
    ),
    tabPanel(
      "Labs",
      div(
        class = "section-card",
        div(
          class = "control-grid",
          selectInput("lab_test", "Lab test", choices = sort(unique(labs$lab_test)), selected = "ALT")
        ),
        plotOutput("lab_trend", height = "260px"),
        tableOutput("lab_table")
      )
    ),
    tabPanel(
      "AEs",
      div(
        class = "section-card",
        h2("Adverse events"),
        uiOutput("ae_summary_chips"),
        tableOutput("ae_summary_table"),
        tableOutput("ae_table")
      )
    ),
    tabPanel(
      "Meds",
      div(
        class = "section-card",
        h2("Concomitant medications"),
        tableOutput("med_table")
      ),
      div(
        class = "section-card",
        h2("Exposure"),
        tableOutput("exposure_table")
      )
    ),
    tabPanel(
      "Reports",
      div(
        class = "section-card",
        div(
          class = "report-intro",
          div(
            h2("Review-ready reports"),
            p("Fixed-format synthetic reports generated from the selected subject and registered data pack.")
          ),
          div(class = "print-hint", "Use browser print for a PDF-style handout.")
        ),
        div(class = "report-warning", "Synthetic demo and technical evaluation only. Not for clinical decision making.")
      ),
      tabsetPanel(
        tabPanel(
          "Subject Snapshot",
          div(
            id = "subject_snapshot_report",
            class = "report-page",
            div(
              class = "report-title",
              div(
                div(class = "eyebrow", "Subject-level report"),
                h2("Subject Snapshot Report"),
                p("A concise clinical profile summary for walkthroughs and reviewer orientation.")
              ),
              div(class = "report-meta", textOutput("snapshot_report_meta", inline = TRUE))
            ),
            uiOutput("snapshot_kpis"),
            uiOutput("snapshot_narrative"),
            tableOutput("snapshot_report_table"),
            div(class = "table-note", "Source: synthetic demographics, visits, exposure, labs, and AE files.")
          )
        ),
        tabPanel(
          "Safety Review",
          div(
            id = "safety_review_report",
            class = "report-page",
            div(
              class = "report-title",
              div(
                div(class = "eyebrow", "Safety monitoring report"),
                h2("Safety Review Worksheet"),
                p("Signal-oriented review items with traceable source evidence.")
              ),
              div(class = "report-meta", textOutput("safety_report_meta", inline = TRUE))
            ),
            uiOutput("safety_review_kpis"),
            tableOutput("safety_review_table"),
            div(class = "table-note", "Review status is computed from synthetic AE, lab, and exposure records.")
          )
        ),
        tabPanel(
          "Data Listing",
          div(
            id = "data_listing_report",
            class = "report-page",
            div(
              class = "report-title",
              div(
                div(class = "eyebrow", "Audit-style listing"),
                h2("Subject Data Listing Pack"),
                p("Compact listings used to explain traceability from source data to visual profile.")
              ),
              div(class = "report-meta", textOutput("listing_report_meta", inline = TRUE))
            ),
            div(
              class = "listing-grid",
              div(class = "listing-panel", h3("Visits"), tableOutput("listing_visits")),
              div(class = "listing-panel", h3("Exposure"), tableOutput("listing_exposure")),
              div(class = "listing-panel", h3("Adverse events"), tableOutput("listing_aes")),
              div(class = "listing-panel", h3("Abnormal labs"), tableOutput("listing_abnormal_labs"))
            )
          )
        )
      )
    )
  )
)

server <- function(input, output, session) {
  selected_subject <- reactive({
    value <- input$subject_id
    if (is.null(value) || !(value %in% demographics$subject_id)) {
      primary_subject
    } else {
      value
    }
  })

  subject_profile <- reactive(subject_rows(demographics, selected_subject()))
  subject_visits <- reactive(subject_rows(visits, selected_subject()))
  subject_labs <- reactive(subject_rows(labs, selected_subject()))
  subject_vitals <- reactive(subject_rows(vitals, selected_subject()))
  subject_aes <- reactive(subject_rows(adverse_events, selected_subject()))
  subject_meds <- reactive(subject_rows(concomitant_meds, selected_subject()))
  subject_exposure <- reactive(subject_rows(exposure, selected_subject()))

  observeEvent(selected_subject(), {
    choices <- sort(unique(subject_labs()$lab_test))
    if (length(choices) == 0) {
      choices <- sort(unique(labs$lab_test))
    }
    selected <- if ("ALT" %in% choices) "ALT" else choices[1]
    updateSelectInput(session, "lab_test", choices = choices, selected = selected)
  }, ignoreInit = FALSE)

  output$subject_metric <- renderText(selected_subject())
  output$arm_metric <- renderText(first_or_na(subject_profile()$arm))
  output$ae_metric <- renderText(nrow(subject_aes()))
  output$visit_metric <- renderText(first_or_na(tail(subject_visits()$visit, 1)))
  output$profile_check <- renderText(
    paste(selected_subject(), paste0("AE count: ", nrow(subject_aes())), "Lab trend: ALT")
  )

  output$profile_table <- renderTable(
    subject_profile()[, c("subject_id", "site_id", "arm", "sex", "age", "region", "study_status")],
    striped = TRUE,
    spacing = "s"
  )

  plot_lab <- function(data, title) {
    if (nrow(data) == 0) {
      plot.new()
      title("No lab data available")
      return()
    }
    plot(
      data$visit_day,
      data$lab_value,
      type = "b",
      pch = 19,
      col = "#145f67",
      xlab = "Study day",
      ylab = paste0(data$lab_test[1], " (", data$unit[1], ")"),
      main = title
    )
    abline(h = data$high[1], col = "#a93f2b", lty = 2)
    grid(col = "#d7dee3")
  }

  output$overview_lab_trend <- renderPlot({
    data <- subject_labs()
    plot_lab(data[data$lab_test == "ALT", , drop = FALSE], paste(selected_subject(), "ALT trend"))
  })

  output$lab_trend <- renderPlot({
    data <- subject_labs()
    lab_test <- input$lab_test
    if (is.null(lab_test) || lab_test == "") {
      lab_test <- "ALT"
    }
    data <- data[data$lab_test == lab_test, , drop = FALSE]
    plot_lab(data, paste(selected_subject(), lab_test, "trend"))
  })

  output$exposure_ae_timeline <- renderPlot({
    exposure_rows <- subject_exposure()
    ae_rows <- subject_aes()
    days <- c(exposure_rows$start_day, exposure_rows$end_day, ae_rows$start_day, ae_rows$end_day)
    days <- suppressWarnings(as.numeric(days[days != ""]))
    if (length(days) == 0) {
      plot.new()
      title("No exposure or AE data available")
      return()
    }

    plot(
      range(days, na.rm = TRUE),
      c(0.5, max(2, nrow(ae_rows) + 1.5)),
      type = "n",
      xlab = "Study day",
      ylab = "",
      yaxt = "n",
      main = paste(selected_subject(), "exposure and AE timeline")
    )
    axis(2, at = 1, labels = "Exposure", las = 1)
    grid(col = "#d7dee3")

    for (index in seq_len(nrow(exposure_rows))) {
      rect(
        as.numeric(exposure_rows$start_day[index]),
        0.75,
        as.numeric(exposure_rows$end_day[index]),
        1.25,
        col = "#b7dfe5",
        border = "#145f67"
      )
      text(
        mean(c(as.numeric(exposure_rows$start_day[index]), as.numeric(exposure_rows$end_day[index]))),
        1,
        labels = exposure_rows$cycle[index],
        cex = 0.75
      )
    }

    severity_colors <- c(Mild = "#4f8f6b", Moderate = "#c0892b", Severe = "#b0443f")
    for (index in seq_len(nrow(ae_rows))) {
      y <- index + 1
      start <- as.numeric(ae_rows$start_day[index])
      end <- as.numeric(ifelse(ae_rows$end_day[index] == "", ae_rows$start_day[index], ae_rows$end_day[index]))
      color <- unname(severity_colors[ae_rows$severity[index]])
      if (is.na(color)) {
        color <- "#526b79"
      }
      segments(start, y, end, y, lwd = 5, col = color)
      points(start, y, pch = 19, col = color)
      text(end, y, labels = ae_rows$ae_term[index], pos = 4, cex = 0.75)
    }
    axis(2, at = seq_len(nrow(ae_rows)) + 1, labels = paste("AE", seq_len(nrow(ae_rows))), las = 1)
  })

  output$vitals_table <- renderTable(
    subject_vitals()[, c("visit", "visit_day", "systolic_bp", "diastolic_bp", "heart_rate", "weight_kg")],
    striped = TRUE,
    spacing = "s"
  )

  output$timeline <- renderUI({
    rows <- subject_visits()
    div(
      class = "timeline-list",
      lapply(seq_len(nrow(rows)), function(index) {
        div(
          class = "timeline-row",
          strong(paste0("Day ", rows$visit_day[index])),
          span(rows$visit[index]),
          span(rows$disposition[index])
        )
      })
    )
  })

  output$ae_summary_chips <- renderUI({
    rows <- subject_aes()
    serious_count <- sum(rows$serious == "Y")
    related_count <- sum(rows$related %in% c("Possible", "Probable", "Related"))
    severity_rank <- c(Mild = 1, Moderate = 2, Severe = 3)
    max_severity <- if (nrow(rows) == 0) {
      "n/a"
    } else {
      names(which.max(tapply(severity_rank[rows$severity], rows$severity, max, na.rm = TRUE)))
    }
    div(
      class = "ae-chip-row",
      span(class = "ae-chip", paste("Total", nrow(rows))),
      span(class = "ae-chip", paste("Serious", serious_count)),
      span(class = "ae-chip", paste("Related/Possible", related_count)),
      span(class = "ae-chip", paste("Max severity", max_severity))
    )
  })

  output$ae_summary_table <- renderTable({
    rows <- subject_aes()
    if (nrow(rows) == 0) {
      return(data.frame(severity = character(), related = character(), serious = character(), count = integer()))
    }
    summary <- aggregate(ae_id ~ severity + related + serious, data = rows, FUN = length)
    names(summary)[names(summary) == "ae_id"] <- "count"
    summary
  }, striped = TRUE, spacing = "s")

  output$lab_table <- renderTable(
    subject_labs()[, c("visit", "visit_day", "lab_test", "lab_value", "unit", "low", "high", "flag")],
    striped = TRUE,
    spacing = "s"
  )

  output$ae_table <- renderTable(
    subject_aes()[, c("ae_id", "ae_term", "start_day", "end_day", "severity", "serious", "related", "outcome")],
    striped = TRUE,
    spacing = "s"
  )

  output$med_table <- renderTable(
    subject_meds()[, c("medication", "indication", "start_day", "end_day", "ongoing")],
    striped = TRUE,
    spacing = "s"
  )

  output$exposure_table <- renderTable(
    subject_exposure()[, c("cycle", "start_day", "end_day", "dose_mg", "dose_status", "dose_intensity_pct")],
    striped = TRUE,
    spacing = "s"
  )

  output$snapshot_report_meta <- renderText({
    paste(selected_subject(), "|", data_pack_id)
  })

  output$safety_report_meta <- renderText({
    paste(selected_subject(), "|", data_pack_id)
  })

  output$listing_report_meta <- renderText({
    paste(selected_subject(), "|", data_pack_id)
  })

  output$snapshot_kpis <- renderUI({
    profile <- subject_profile()
    aes <- subject_aes()
    labs <- subject_labs()
    exposure_rows <- subject_exposure()
    div(
      class = "report-grid",
      div(class = "report-kpi", span("Subject"), strong(selected_subject())),
      div(class = "report-kpi", span("Arm / status"), strong(paste(first_or_na(profile$arm), first_or_na(profile$study_status), sep = " / "))),
      div(class = "report-kpi", span("AE / SAE"), strong(paste0(nrow(aes), " / ", sum(aes$serious == "Y")))),
      div(class = "report-kpi", span("Abnormal labs"), strong(count_abnormal_labs(labs))),
      div(class = "report-kpi", span("Max severity"), strong(max_severity(aes))),
      div(class = "report-kpi", span("Dose cycles"), strong(nrow(exposure_rows))),
      div(class = "report-kpi", span("Related AEs"), strong(count_related(aes))),
      div(class = "report-kpi", span("Latest visit"), strong(first_or_na(tail(subject_visits()$visit, 1))))
    )
  })

  output$snapshot_narrative <- renderUI({
    profile <- subject_profile()
    aes <- subject_aes()
    labs <- subject_labs()
    exposure_rows <- subject_exposure()
    div(
      class = "report-narrative",
      paste0(
        selected_subject(), " is a ", first_or_na(profile$age), "-year-old ", first_or_na(profile$sex),
        " subject in the ", first_or_na(profile$arm), " arm. The synthetic profile includes ",
        nrow(exposure_rows), " exposure cycle(s), ", nrow(aes), " adverse event(s), ",
        sum(aes$serious == "Y"), " serious adverse event(s), and ",
        count_abnormal_labs(labs), " abnormal lab record(s)."
      )
    )
  })

  output$snapshot_report_table <- renderTable({
    build_subject_snapshot(subject_profile(), subject_visits(), subject_aes(), subject_labs(), subject_exposure())
  }, striped = TRUE, spacing = "s")

  output$safety_review_kpis <- renderUI({
    aes <- subject_aes()
    labs <- subject_labs()
    high_labs <- labs[labs$flag != "Normal", , drop = FALSE]
    div(
      class = "report-grid",
      div(class = "report-kpi", span("SAE"), strong(sum(aes$serious == "Y"))),
      div(class = "report-kpi", span("Related/Possible"), strong(count_related(aes))),
      div(class = "report-kpi", span("High labs"), strong(nrow(high_labs))),
      div(class = "report-kpi", span("Review path"), strong(ifelse(sum(aes$serious == "Y") > 0 || nrow(high_labs) > 0, "Follow-up", "Routine")))
    )
  })

  output$safety_review_table <- renderTable({
    build_safety_review(subject_aes(), subject_labs(), subject_exposure())
  }, striped = TRUE, spacing = "s")

  output$listing_visits <- renderTable({
    subject_visits()[, c("visit", "visit_day", "visit_date", "visit_status", "disposition")]
  }, striped = TRUE, spacing = "s")

  output$listing_exposure <- renderTable({
    subject_exposure()[, c("cycle", "start_day", "end_day", "dose_mg", "dose_status", "dose_intensity_pct")]
  }, striped = TRUE, spacing = "s")

  output$listing_aes <- renderTable({
    subject_aes()[, c("ae_id", "ae_term", "start_day", "end_day", "severity", "serious", "related")]
  }, striped = TRUE, spacing = "s")

  output$listing_abnormal_labs <- renderTable({
    rows <- subject_labs()
    rows <- rows[rows$flag != "Normal", , drop = FALSE]
    rows[, c("visit", "visit_day", "lab_test", "lab_value", "unit", "low", "high", "flag")]
  }, striped = TRUE, spacing = "s")

  observe({
    session$sendCustomMessage(
      "harness-diagnostics",
      list(
        loadStatus = "loaded",
        sampleDataLoaded = TRUE,
        subjectCount = nrow(demographics),
        profileSubject = selected_subject(),
        aeCount = nrow(subject_aes()),
        seriousAeCount = sum(subject_aes()$serious == "Y"),
        labCount = nrow(subject_labs()),
        labTest = input$lab_test,
        reportCount = 3,
        dataPackId = data_pack_id,
        rSmokeResult = as.character(1 + 1)
      )
    )
  })
}

shinyApp(ui, server)
