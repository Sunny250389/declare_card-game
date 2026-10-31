import { Screen, TopBar } from "../components/ui.jsx";
import { MatchStats } from "./Results.jsx";

export function StatisticsScreen({ match, onBack }) {
  return (
    <Screen>
      <TopBar title="Statistics" onBack={onBack} />
      {match ? (
        <>
          <MatchStats match={match} />
          {match.players.map((player) => (
            <div key={player.id} className="leader-row">
              <span className="result-name">{player.name}</span>
              <span className="result-score">{player.totalScore}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">No match data yet.</p>
      )}
    </Screen>
  );
}

export function SettingsScreen({ settings, setSettings, onBack }) {
  return (
    <Screen>
      <TopBar title="Settings" onBack={onBack} />
      <SettingRow label="Dark mode" checked={settings.darkMode} onChange={(darkMode) => setSettings({ ...settings, darkMode })} />
      <SettingRow label="Large cards" checked={settings.largeCards} onChange={(largeCards) => setSettings({ ...settings, largeCards })} />
    </Screen>
  );
}

export function SettingRow({ label, checked, onChange }) {
  return (
    <label className="setting-row">
      <span className="result-name">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
