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

profile_css <- "
  body { background: #f5f7f8; color: #17212b; }
  .eyebrow { color: #496675; font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
  .profile-header { align-items: flex-end; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 16px; }
  .selector { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; padding: 12px; min-width: 240px; }
  .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
  .metric { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; padding: 14px; }
  .metric span { color: #526b79; display: block; font-size: 12px; font-weight: 800; margin-bottom: 8px; }
  .metric strong { color: #101820; font-size: 24px; line-height: 1; overflow-wrap: anywhere; }
  .profile-check { background: #e7f4ee; border: 1px solid #a9d6c4; border-radius: 8px; color: #0d6b4f; font-size: 13px; font-weight: 800; margin-bottom: 14px; padding: 10px 12px; }
  .section-card { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; margin-top: 14px; padding: 16px; }
  .timeline-list { display: grid; gap: 8px; }
  .timeline-row { align-items: center; border-bottom: 1px solid #edf1f3; display: grid; gap: 10px; grid-template-columns: 80px 1fr 130px; padding: 8px 0; }
  .timeline-row strong { color: #101820; }
  .timeline-row span { color: #526b79; font-size: 13px; }
  .data-note { color: #526b79; font-size: 12px; font-weight: 700; margin-top: 8px; }
  @media (max-width: 860px) {
    .profile-header { align-items: stretch; flex-direction: column; }
    .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .timeline-row { grid-template-columns: 1fr; }
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
      selectInput("subject_id", "Subject", choices = demographics$subject_id, selected = primary_subject)
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
      )
    ),
    tabPanel(
      "Labs",
      div(
        class = "section-card",
        selectInput("lab_test", "Lab test", choices = sort(unique(labs$lab_test)), selected = "ALT"),
        plotOutput("lab_trend", height = "260px"),
        tableOutput("lab_table")
      )
    ),
    tabPanel(
      "AEs",
      div(
        class = "section-card",
        h2("Adverse events"),
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

  output$subject_metric <- renderText(selected_subject())
  output$arm_metric <- renderText(subject_profile()$arm[1])
  output$ae_metric <- renderText(nrow(subject_aes()))
  output$visit_metric <- renderText(tail(subject_visits()$visit, 1))
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
    data <- data[data$lab_test == input$lab_test, , drop = FALSE]
    plot_lab(data, paste(selected_subject(), input$lab_test, "trend"))
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

  observe({
    session$sendCustomMessage(
      "harness-diagnostics",
      list(
        loadStatus = "loaded",
        sampleDataLoaded = TRUE,
        subjectCount = nrow(demographics),
        profileSubject = selected_subject(),
        aeCount = nrow(subject_aes()),
        labCount = nrow(subject_labs()),
        dataPackId = data_pack_id,
        rSmokeResult = as.character(1 + 1)
      )
    )
  })
}

shinyApp(ui, server)
