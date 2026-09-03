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
    let mut session = TerminalSession::start()?;
    run_loop(&mut session.terminal, client).await
}

struct TerminalSession {
    terminal: WrkpadTerminal,
}

impl TerminalSession {
    fn start() -> Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        if let Err(error) = execute!(stdout, EnterAlternateScreen) {
            let _ = disable_raw_mode();
            return Err(error.into());
        }
        let backend = CrosstermBackend::new(stdout);
        match Terminal::new(backend) {
            Ok(terminal) => Ok(Self { terminal }),
            Err(error) => {
                let mut recovery = io::stdout();
                let _ = execute!(recovery, LeaveAlternateScreen);
                let _ = disable_raw_mode();
                Err(error.into())
            }
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(self.terminal.backend_mut(), LeaveAlternateScreen);
        let _ = self.terminal.show_cursor();
    }
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

    let [board, inspector] =
        Layout::horizontal([Constraint::Percentage(62), Constraint::Percentage(38)]).areas(content);
    render_physical_board(frame, board, snapshot);
    render_inspector(frame, inspector, snapshot);

    frame.render_widget(
        Paragraph::new(format!(
            " revision {} · {} unassigned · q quit · desired light only, not hardware proof",
            snapshot.revision, snapshot.unassigned_active_sessions
        ))
        .style(Style::default().fg(Color::DarkGray)),
        footer,
    );
}

fn render_physical_board(frame: &mut ratatui::Frame<'_>, area: Rect, snapshot: &BoardSnapshot) {
    let shell = Block::default()
        .title(" Creator Micro 2 · physical twin ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray));
    let inner = shell.inner(area);
    frame.render_widget(shell, area);
    let rows = Layout::vertical([
        Constraint::Percentage(25),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
    ])
    .split(inner);

    let top = four_columns(rows[0]);
    render_control(
        frame,
        top[0],
        "DIAL",
        "encoder\nInput-owned",
        Color::DarkGray,
    );
    if let Some(slot) = snapshot.slots.first() {
        render_agent_key(frame, top[1], slot);
    }
    if let Some(slot) = snapshot.slots.get(1) {
        render_agent_key(frame, top[2], slot);
    }
    render_control(
        frame,
        top[3],
        "JOYSTICK",
        "planar toggle\nInput-owned",
        Color::DarkGray,
    );

    let agents = four_columns(rows[1]);
    for (column, slot) in agents.iter().zip(snapshot.slots.iter().skip(2)) {
        render_agent_key(frame, *column, slot);
    }

    let actions = four_columns(rows[2]);
    for (offset, column) in actions.iter().enumerate() {
        render_control(
            frame,
            *column,
            &format!("ACT{:02}", offset + 6),
            "workflow signal\nInput layer",
            Color::Rgb(72, 82, 98),
        );
    }

    let bottom = four_columns(rows[3]);
    render_control(
        frame,
        bottom[0],
        "TOUCH",
        "host selector\nfirmware-owned",
        Color::Rgb(72, 82, 98),
    );
    render_control(
        frame,
        bottom[1],
        "ACT10",
        "separate key\nInput layer",
        Color::Rgb(109, 93, 252),
    );
    render_control(
        frame,
        bottom[2],
        "ACT11",
        "separate key\nInput layer",
        Color::Rgb(109, 93, 252),
    );
    render_control(
        frame,
        bottom[3],
        "ACT12",
        "transparent key\nInput layer",
        Color::Rgb(180, 205, 202),
    );
}

fn four_columns(area: Rect) -> std::rc::Rc<[Rect]> {
    Layout::horizontal([
        Constraint::Percentage(25),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
    ])
    .split(area)
}

fn render_agent_key(frame: &mut ratatui::Frame<'_>, area: Rect, slot: &SlotView) {
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
        .title(format!(" AG{:02} ", slot.slot - 1))
        .title_style(Style::default().fg(color).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(color));
    let body = vec![
        Line::from(Span::styled(
            format!("{state:?}"),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            title,
            Style::default().add_modifier(Modifier::BOLD),
        )),
        Line::from(format!("{provider} · {binding}")),
    ];
    frame.render_widget(Paragraph::new(body).block(block), area);
}

fn render_control(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    label: &str,
    description: &str,
    color: Color,
) {
    frame.render_widget(
        Paragraph::new(description)
            .style(Style::default().fg(Color::DarkGray))
            .block(
                Block::default()
                    .title(format!(" {label} "))
                    .title_style(Style::default().fg(color).add_modifier(Modifier::BOLD))
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(color)),
            ),
        area,
    );
}

fn render_inspector(frame: &mut ratatui::Frame<'_>, area: Rect, snapshot: &BoardSnapshot) {
    let mut lines = vec![
        Line::from(Span::styled(
            "LIVE AGENT SLOTS",
            Style::default().add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
    ];
    for slot in &snapshot.slots {
        let line = slot.session.as_ref().map_or_else(
            || format!("AG{:02}  Off", slot.slot - 1),
            |session| {
                format!(
                    "AG{:02}  {:?} · {:?} · {}",
                    slot.slot - 1,
                    session.state,
                    session.provider,
                    session.title.as_deref().unwrap_or("Agent session")
                )
            },
        );
        lines.push(Line::from(line));
    }
    lines.extend([
        Line::from(""),
        Line::from(Span::styled(
            "PRIORITY",
            Style::default().add_modifier(Modifier::BOLD),
        )),
        Line::from("Error > NeedsInput > Working"),
        Line::from("Unread > Idle > Off"),
        Line::from(""),
        Line::from("Observe mode · zero HID writes"),
    ]);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .title(" Operator view ")
                .borders(Borders::ALL),
        ),
        area,
    );
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

#[cfg(test)]
mod tests {
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::draw;
    use crate::model::BoardSnapshot;

    #[test]
    fn physical_twin_renders_exact_control_geometry() -> anyhow::Result<()> {
        let backend = TestBackend::new(140, 42);
        let mut terminal = Terminal::new(backend)?;
        terminal.draw(|frame| draw(frame, &BoardSnapshot::empty(), "HASP linked"))?;
        let buffer = terminal.backend().buffer();
        let mut rendered = String::new();
        for y in 0..buffer.area.height {
            for x in 0..buffer.area.width {
                if let Some(cell) = buffer.cell((x, y)) {
                    rendered.push_str(cell.symbol());
                }
            }
            rendered.push('\n');
        }

        for label in [
            "DIAL", "AG00", "AG01", "JOYSTICK", "AG02", "AG03", "AG04", "AG05", "ACT06", "ACT07",
            "ACT08", "ACT09", "TOUCH", "ACT10", "ACT11", "ACT12",
        ] {
            assert!(rendered.contains(label), "missing physical control {label}");
        }
        assert!(rendered.contains("separate key"));
        assert!(rendered.contains("transparent key"));
        assert!(rendered.contains("zero HID writes"));
        Ok(())
    }
}
