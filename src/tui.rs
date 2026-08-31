use std::io::{self, Stdout};
use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::client::HaspClient;
use crate::model::{AgentState, BoardSnapshot, SlotView};

type WrkpadTerminal = Terminal<CrosstermBackend<Stdout>>;

pub async fn run(client: HaspClient) -> Result<()> {
    let mut terminal = start_terminal()?;
    let result = run_loop(&mut terminal, client).await;
    stop_terminal(&mut terminal)?;
    result
}

async fn run_loop(terminal: &mut WrkpadTerminal, client: HaspClient) -> Result<()> {
    let mut snapshot = BoardSnapshot::empty();
    let mut connection = "connecting".to_owned();
    let mut last_refresh = Instant::now();
    let mut refresh_due = true;
    loop {
        if refresh_due || last_refresh.elapsed() >= Duration::from_millis(500) {
            match client.snapshot().await {
                Ok(next) => {
                    snapshot = next;
                    "HASP linked".clone_into(&mut connection);
                }
                Err(error) => {
                    connection = format!("observe-only · {error}");
                }
            }
            last_refresh = Instant::now();
            refresh_due = false;
        }

        terminal.draw(|frame| draw(frame, &snapshot, &connection))?;
        if event::poll(Duration::from_millis(50))?
            && let Event::Key(key) = event::read()?
            && key.kind == KeyEventKind::Press
            && matches!(key.code, KeyCode::Char('q') | KeyCode::Esc)
        {
            break;
        }
    }
    Ok(())
}

fn draw(frame: &mut ratatui::Frame<'_>, snapshot: &BoardSnapshot, connection: &str) {
    let [header, content, footer] = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(12),
        Constraint::Length(2),
    ])
    .areas(frame.area());

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                " WRKPAD ",
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Rgb(109, 93, 252))
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  Hardware Agent Status Protocol  "),
            Span::styled(connection, Style::default().fg(Color::DarkGray)),
        ]))
        .block(Block::default().borders(Borders::BOTTOM)),
        header,
    );

    let rows =
        Layout::vertical([Constraint::Percentage(50), Constraint::Percentage(50)]).split(content);
    for row in 0..2 {
        let columns = Layout::horizontal([
            Constraint::Percentage(33),
            Constraint::Percentage(34),
            Constraint::Percentage(33),
        ])
        .split(rows[row]);
        for column in 0..3 {
            let index = row * 3 + column;
            if let Some(slot) = snapshot.slots.get(index) {
                render_slot(frame, columns[column], slot);
            }
        }
    }

    frame.render_widget(
        Paragraph::new(format!(
            " revision {} · {} unassigned · q quit · desired light only, not hardware proof",
            snapshot.revision, snapshot.unassigned_active_sessions
        ))
        .style(Style::default().fg(Color::DarkGray)),
        footer,
    );
}

fn render_slot(frame: &mut ratatui::Frame<'_>, area: Rect, slot: &SlotView) {
    let (state, provider, title, binding) = slot.session.as_ref().map_or(
        (
            AgentState::Off,
            "—".to_owned(),
            "Unbound".to_owned(),
            String::new(),
        ),
        |session| {
            (
                session.state,
                format!("{:?}", session.provider),
                session
                    .title
                    .clone()
                    .unwrap_or_else(|| "Agent session".to_owned()),
                session
                    .session_id
                    .chars()
                    .rev()
                    .take(8)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect(),
            )
        },
    );
    let color = state_color(state);
    let block = Block::default()
        .title(format!(" AG{:02} · {:?} ", slot.slot - 1, state))
        .title_style(Style::default().fg(color).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(color));
    let body = vec![
        Line::from(Span::styled(
            title,
            Style::default().add_modifier(Modifier::BOLD),
        )),
        Line::from(provider),
        Line::from(Span::styled(binding, Style::default().fg(Color::DarkGray))),
    ];
    frame.render_widget(Paragraph::new(body).block(block), area);
}

const fn state_color(state: AgentState) -> Color {
    match state {
        AgentState::Error => Color::Rgb(255, 49, 89),
        AgentState::NeedsInput => Color::Rgb(255, 176, 32),
        AgentState::Working => Color::Rgb(109, 93, 252),
        AgentState::Unread => Color::Rgb(0, 212, 255),
        AgentState::Idle => Color::Rgb(22, 51, 77),
        AgentState::Off => Color::Rgb(50, 50, 50),
    }
}

fn start_terminal() -> Result<WrkpadTerminal> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    Ok(Terminal::new(backend)?)
}

fn stop_terminal(terminal: &mut WrkpadTerminal) -> Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}
