library(shiny)

subjects <- read.csv("data/subject_safety.csv")

ui <- fluidPage(
  tags$head(
    tags$style(HTML("
      body { background: #f5f7f8; color: #17212b; }
      .label { color: #496675; font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
      .metric { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; padding: 14px; }
      .metric span { color: #526b79; display: block; font-size: 12px; font-weight: 700; margin-bottom: 8px; }
      .metric strong { color: #101820; font-size: 26px; line-height: 1; }
      .table-wrap { background: #fff; border: 1px solid #d7dee3; border-radius: 8px; padding: 16px; }
      @media (max-width: 760px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    ")),
    tags$script(src = "harness-diagnostics.js")
  ),
  div(class = "label", "Clinical smoke app"),
  h1("Subject Safety Mini Dashboard"),
  div(
    class = "metric-grid",
    div(class = "metric", span("Total subjects"), strong(textOutput("subject_count", inline = TRUE))),
    div(class = "metric", span("AE count"), strong(textOutput("ae_count", inline = TRUE))),
    div(class = "metric", span("Serious AE count"), strong(textOutput("sae_count", inline = TRUE))),
    div(class = "metric", span("R smoke result"), strong(textOutput("r_smoke", inline = TRUE)))
  ),
  div(
    class = "table-wrap",
    h2("Subject snapshot"),
    tableOutput("subject_table")
  )
)

server <- function(input, output, session) {
  output$subject_count <- renderText(nrow(subjects))
  output$ae_count <- renderText(sum(subjects$ae_count))
  output$sae_count <- renderText(sum(subjects$serious_ae_count))
  output$r_smoke <- renderText(1 + 1)
  output$subject_table <- renderTable(
    subjects[, c("subject_id", "arm", "ae_count", "serious_ae_count", "last_visit_day")],
    striped = TRUE,
    spacing = "s"
  )

  observe({
    session$sendCustomMessage(
      "harness-diagnostics",
      list(
        loadStatus = "loaded",
        sampleDataLoaded = TRUE,
        subjectCount = nrow(subjects),
        aeCount = sum(subjects$ae_count),
        seriousAeCount = sum(subjects$serious_ae_count),
        rSmokeResult = as.character(1 + 1)
      )
    )
  })
}

shinyApp(ui, server)
