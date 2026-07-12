import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { cardLabel } from "./src/engine/cards";
import {
  canDeclare,
  createMatch,
  currentPlayer,
  declareRound,
  discardCards,
  drawCard,
  finalLeaderboard,
  handValue,
  nextRound
} from "./src/engine/gameEngine";
import { playUntilHumanTurn } from "./src/engine/ai";

const SAVE_KEY = "declare.savedMatch.v1";

const baseSetup = {
  numberOfPlayers: 4,
  playerTypes: ["human", "ai", "ai", "ai", "ai", "ai"],
  playerNames: ["You", "Mira", "Dev", "Kavya", "Noah", "Ira"],
  difficulties: ["medium", "medium", "medium", "hard", "easy", "medium"]
};

export default function App() {
  const [screen, setScreen] = useState("home");
  const [setup, setSetup] = useState(baseSetup);
  const [match, setMatch] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [settings, setSettings] = useState({ darkMode: true, largeCards: false });
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [savedAvailable, setSavedAvailable] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState(null);

  const theme = useMemo(() => makeTheme(settings.darkMode), [settings.darkMode]);
  const styles = useMemo(() => createStyles(theme, settings.largeCards), [theme, settings.largeCards]);

  useEffect(() => {
    AsyncStorage.getItem(SAVE_KEY).then((value) => setSavedAvailable(Boolean(value)));
  }, []);

  useEffect(() => {
    if (!match) return;
    AsyncStorage.setItem(SAVE_KEY, JSON.stringify(match)).then(() => setSavedAvailable(true));
  }, [match]);

  useEffect(() => {
    if (!match || screen !== "gameplay" || match.status !== "playing") return undefined;
    if (currentPlayer(match).type !== "ai") return undefined;
    const timer = setTimeout(() => {
      setSelectedIds([]);
      setMatch((previous) => {
        const next = playUntilHumanTurn(previous);
        if (next.status === "roundResult") setScreen("roundResult");
        if (next.status === "matchResult") setScreen("matchResult");
        return next;
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [match, screen]);

  function startMatch() {
    const players = Array.from({ length: setup.numberOfPlayers }, (_, index) => ({
      id: `p${index + 1}`,
      name: setup.playerNames[index] || `Player ${index + 1}`,
      type: setup.playerTypes[index],
      difficulty: setup.difficulties[index]
    }));
    const created = playUntilHumanTurn(createMatch({ players, darkMode: settings.darkMode }));
    setMatch(created);
    setSelectedIds([]);
    setScreen("gameplay");
  }

  async function resumeMatch() {
    const saved = await AsyncStorage.getItem(SAVE_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    setMatch(parsed);
    setSelectedIds([]);
    setScreen(parsed.status === "roundResult" ? "roundResult" : parsed.status === "matchResult" ? "matchResult" : "gameplay");
  }

  function updateMatchWith(action) {
    try {
      const next = action(match);
      setMatch(next);
      setSelectedIds([]);
      if (next.status === "roundResult") setScreen("roundResult");
      if (next.status === "matchResult") setScreen("matchResult");
    } catch (error) {
      Alert.alert("Move blocked", error.message);
    }
  }

  function selectCard(card) {
    if (!match || currentPlayer(match).type !== "human") return;
    const hand = match.hands[currentPlayer(match).id];
    const selectedCards = selectedIds.map((id) => hand.find((item) => item.id === id)).filter(Boolean);
    if (selectedCards.length > 0 && selectedCards[0].rank !== card.rank && !selectedIds.includes(card.id)) {
      setSelectedIds([card.id]);
      return;
    }
    setSelectedIds((ids) => (ids.includes(card.id) ? ids.filter((id) => id !== card.id) : [...ids, card.id]));
  }

  const content = {
    home: (
      <HomeScreen
        styles={styles}
        savedAvailable={savedAvailable}
        onNewGame={() => setScreen("setup")}
        onResume={resumeMatch}
        onStatistics={() => setScreen("statistics")}
        onSettings={() => setScreen("settings")}
        onOnline={() => setScreen("online")}
      />
    ),
    setup: <SetupScreen styles={styles} setup={setup} setSetup={setSetup} onBack={() => setScreen("home")} onStart={startMatch} />,
    gameplay: match && (
      <GameplayScreen
        styles={styles}
        match={match}
        selectedIds={selectedIds}
        onSelectCard={selectCard}
        onDraw={(source) => updateMatchWith((state) => drawCard(state, currentPlayer(state).id, source))}
        onDiscard={() => updateMatchWith((state) => discardCards(state, currentPlayer(state).id, selectedIds))}
        onDeclare={() => updateMatchWith((state) => declareRound(state, currentPlayer(state).id))}
        onMenu={() => setScreen("home")}
      />
    ),
    roundResult: match && (
      <RoundResultScreen
        styles={styles}
        match={match}
        onContinue={() => {
          const next = playUntilHumanTurn(nextRound(match));
          setMatch(next);
          setScreen(next.status === "playing" ? "gameplay" : next.status);
        }}
        onMenu={() => setScreen("home")}
      />
    ),
    matchResult: match && <MatchResultScreen styles={styles} match={match} onPlayAgain={startMatch} onNewMatch={() => setScreen("setup")} onExit={() => setScreen("home")} />,
    statistics: <StatisticsScreen styles={styles} match={match} onBack={() => setScreen("home")} />,
    settings: <SettingsScreen styles={styles} settings={settings} setSettings={setSettings} onBack={() => setScreen("home")} />,
    online: <OnlineScreen styles={styles} room={onlineRoom} setRoom={setOnlineRoom} onBack={() => setScreen("home")} />
  }[screen];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={settings.darkMode ? "light-content" : "dark-content"} />
      <ExpoStatusBar style={settings.darkMode ? "light" : "dark"} />
      {content}
      <ScoreboardModal styles={styles} visible={scoreboardOpen} match={match} onClose={() => setScoreboardOpen(false)} />
    </SafeAreaView>
  );
}

function HomeScreen({ styles, savedAvailable, onNewGame, onResume, onStatistics, onSettings, onOnline }) {
  return (
    <Screen styles={styles}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>DECLARE</Text>
        <Text style={styles.title}>Lowest hand wins.</Text>
      </View>
      <PrimaryButton styles={styles} label="New Game" onPress={onNewGame} />
      <PrimaryButton styles={styles} label="Resume Match" disabled={!savedAvailable} onPress={onResume} />
      <PrimaryButton styles={styles} label="Online Game" onPress={onOnline} />
      <View style={styles.row}>
        <SecondaryButton styles={styles} label="Statistics" onPress={onStatistics} />
        <SecondaryButton styles={styles} label="Settings" onPress={onSettings} />
      </View>
    </Screen>
  );
}

function SetupScreen({ styles, setup, setSetup, onBack, onStart }) {
  const indexes = Array.from({ length: setup.numberOfPlayers }, (_, index) => index);
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Setup" onBack={onBack} />
      <Text style={styles.label}>Players</Text>
      <View style={styles.segmentRow}>
        {[2, 3, 4, 5, 6].map((count) => (
          <Pressable key={count} style={[styles.segment, setup.numberOfPlayers === count && styles.segmentActive]} onPress={() => setSetup({ ...setup, numberOfPlayers: count })}>
            <Text style={styles.segmentText}>{count}</Text>
          </Pressable>
        ))}
      </View>
      {indexes.map((index) => (
        <View key={index} style={styles.playerEditor}>
          <TextInput
            style={styles.input}
            value={setup.playerNames[index]}
            placeholder={`Player ${index + 1}`}
            placeholderTextColor={styles.placeholder.color}
            onChangeText={(text) => {
              const playerNames = [...setup.playerNames];
              playerNames[index] = text;
              setSetup({ ...setup, playerNames });
            }}
          />
          <View style={styles.row}>
            {["human", "ai"].map((type) => (
              <Pressable
                key={type}
                style={[styles.smallSegment, setup.playerTypes[index] === type && styles.segmentActive]}
                onPress={() => {
                  const playerTypes = [...setup.playerTypes];
                  playerTypes[index] = type;
                  setSetup({ ...setup, playerTypes });
                }}
              >
                <Text style={styles.segmentText}>{type === "human" ? "Human" : "AI"}</Text>
              </Pressable>
            ))}
          </View>
          {setup.playerTypes[index] === "ai" && (
            <View style={styles.row}>
              {["easy", "medium", "hard"].map((difficulty) => (
                <Pressable
                  key={difficulty}
                  style={[styles.tinySegment, setup.difficulties[index] === difficulty && styles.segmentActive]}
                  onPress={() => {
                    const difficulties = [...setup.difficulties];
                    difficulties[index] = difficulty;
                    setSetup({ ...setup, difficulties });
                  }}
                >
                  <Text style={styles.segmentText}>{capitalize(difficulty)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
      <PrimaryButton styles={styles} label="Start Match" onPress={onStart} />
    </Screen>
  );
}

function GameplayScreen({ styles, match, selectedIds, onSelectCard, onDraw, onDiscard, onDeclare, onMenu }) {
  const player = currentPlayer(match);
  const hand = match.hands[player.id];
  const isHuman = player.type === "human";
  const drawn = match.turn.hasDrawn;
  const declareReady = canDeclare(match, player.id);
  const canDrawFromDrawPile = match.drawPile.length > 0 || match.discardPile.length > 1;

  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title={`Round ${match.roundNumber}`} onBack={onMenu} />
      <View style={styles.statusBand}>
        <Text style={styles.statusTitle}>{player.name}'s turn</Text>
        <Text style={styles.statusText}>{isHuman ? `Hand value ${handValue(hand)}` : "AI thinking"}</Text>
      </View>
      <ScoreboardPanel styles={styles} match={match} />
      <View style={styles.piles}>
        <Pile styles={styles} label="Draw" count={match.drawPile.length || "Mix"} onPress={() => onDraw("draw")} disabled={!isHuman || drawn || !canDrawFromDrawPile} />
        <Pile
          styles={styles}
          label="Discard"
          count={match.discardPile.length}
          top={match.discardPile[match.discardPile.length - 1]}
          onPress={() => onDraw("discard")}
          disabled={!isHuman || drawn || match.discardPile.length === 0}
        />
      </View>
      <Text style={styles.label}>Hand</Text>
      <View style={styles.handGrid}>
        {hand.map((card) => (
          <CardButton key={card.id} styles={styles} card={card} selected={selectedIds.includes(card.id)} onPress={() => onSelectCard(card)} disabled={!isHuman} />
        ))}
      </View>
      <View style={styles.actionBar}>
        <PrimaryButton styles={styles} label="Declare" disabled={!isHuman || !declareReady} onPress={onDeclare} />
        <PrimaryButton styles={styles} label="Discard / End Turn" disabled={!isHuman || !drawn || selectedIds.length === 0} onPress={onDiscard} />
      </View>
    </Screen>
  );
}

function RoundResultScreen({ styles, match, onContinue, onMenu }) {
  const result = match.roundResult;
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Round Result" onBack={onMenu} />
      <ResultBanner styles={styles} type={result.declareResult.type} declarer={playerName(match, result.declarerId)} />
      {match.players.map((player) => (
        <View key={player.id} style={styles.resultRow}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultName}>{player.name}</Text>
            <Text style={styles.resultScore}>{formatDelta(result.declareResult.roundScores[player.id])} / {player.totalScore}</Text>
          </View>
          <Text style={styles.muted}>{match.hands[player.id].map(cardLabel).join("  ")} - value {result.handValues[player.id]}</Text>
        </View>
      ))}
      <PrimaryButton styles={styles} label="Next Round" onPress={onContinue} />
    </Screen>
  );
}

function MatchResultScreen({ styles, match, onPlayAgain, onNewMatch, onExit }) {
  const leaderboard = finalLeaderboard(match);
  return (
    <Screen styles={styles}>
      <Text style={styles.kicker}>WINNER</Text>
      <Text style={styles.title}>{leaderboard[0].name}</Text>
      {leaderboard.map((player, index) => (
        <View key={player.id} style={styles.leaderRow}>
          <Text style={styles.resultName}>{index + 1}. {player.name}</Text>
          <Text style={styles.resultScore}>{player.totalScore}</Text>
        </View>
      ))}
      <View style={styles.statsGrid}>
        <Stat styles={styles} label="Rounds" value={match.matchStats.roundsPlayed} />
        <Stat styles={styles} label="Success" value={match.matchStats.successfulDeclares} />
        <Stat styles={styles} label="Failed" value={match.matchStats.failedDeclares} />
        <Stat styles={styles} label="Special" value={match.matchStats.specialDeclares} />
      </View>
      <PrimaryButton styles={styles} label="Play Again" onPress={onPlayAgain} />
      <View style={styles.row}>
        <SecondaryButton styles={styles} label="New Match" onPress={onNewMatch} />
        <SecondaryButton styles={styles} label="Exit" onPress={onExit} />
      </View>
    </Screen>
  );
}

function StatisticsScreen({ styles, match, onBack }) {
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Statistics" onBack={onBack} />
      {match ? (
        <>
          <View style={styles.statsGrid}>
            <Stat styles={styles} label="Rounds" value={match.matchStats.roundsPlayed} />
            <Stat styles={styles} label="Success" value={match.matchStats.successfulDeclares} />
            <Stat styles={styles} label="Failed" value={match.matchStats.failedDeclares} />
            <Stat styles={styles} label="Special" value={match.matchStats.specialDeclares} />
          </View>
          {match.players.map((player) => (
            <View key={player.id} style={styles.leaderRow}>
              <Text style={styles.resultName}>{player.name}</Text>
              <Text style={styles.resultScore}>{player.totalScore}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.muted}>No match data yet.</Text>
      )}
    </Screen>
  );
}

function SettingsScreen({ styles, settings, setSettings, onBack }) {
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Settings" onBack={onBack} />
      <SettingRow styles={styles} label="Dark mode" value={settings.darkMode} onValueChange={(darkMode) => setSettings({ ...settings, darkMode })} />
      <SettingRow styles={styles} label="Large cards" value={settings.largeCards} onValueChange={(largeCards) => setSettings({ ...settings, largeCards })} />
    </Screen>
  );
}

function OnlineScreen({ styles, room, setRoom, onBack }) {
  function createRoom(kind) {
    setRoom({
      code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      kind,
      players: ["You"],
      ready: false
    });
  }

  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Online Game" onBack={onBack} />
      <PrimaryButton styles={styles} label="Quick Match" onPress={() => createRoom("Quick Match")} />
      <PrimaryButton styles={styles} label="Create Room" onPress={() => createRoom("Private Room")} />
      <PrimaryButton styles={styles} label="Join Room" onPress={() => createRoom("Joined Room")} />
      <View style={styles.row}>
        <SecondaryButton styles={styles} label="Friends" onPress={() => createRoom("Friends")} />
        <SecondaryButton styles={styles} label="History" onPress={() => createRoom("History")} />
      </View>
      {room && (
        <View style={styles.statusBand}>
          <Text style={styles.statusTitle}>{room.kind}</Text>
          <Text style={styles.statusText}>ROOM CODE: {room.code}</Text>
          <SecondaryButton styles={styles} label={room.ready ? "Ready" : "Mark Ready"} onPress={() => setRoom({ ...room, ready: !room.ready })} />
        </View>
      )}
    </Screen>
  );
}

function ScoreboardModal({ styles, visible, match, onClose }) {
  if (!match) return null;
  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.modalShade}>
        <View style={styles.modalPanel}>
          <Text style={styles.heading}>Scorecard</Text>
          {finalLeaderboard(match).map((player) => (
            <View key={player.id} style={styles.leaderRow}>
              <Text style={styles.resultName}>{player.name}</Text>
              <Text style={styles.resultScore}>{player.totalScore}</Text>
            </View>
          ))}
          <PrimaryButton styles={styles} label="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ScoreboardPanel({ styles, match }) {
  return (
    <View style={styles.scoreboardPanel}>
      <Text style={styles.label}>Scorecard</Text>
      {finalLeaderboard(match).map((player) => (
        <View key={player.id} style={styles.scorecardRow}>
          <Text style={styles.resultName}>{player.name}</Text>
          <Text style={styles.resultScore}>{player.totalScore}</Text>
        </View>
      ))}
    </View>
  );
}

function Screen({ styles, children }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

function TopBar({ styles, title, onBack, rightLabel, onRight }) {
  return (
    <View style={styles.topBar}>
      <SecondaryButton styles={styles} label="Back" onPress={onBack} compact />
      <Text style={styles.heading}>{title}</Text>
      {rightLabel ? <SecondaryButton styles={styles} label={rightLabel} onPress={onRight} compact /> : <View style={styles.topSpacer} />}
    </View>
  );
}

function PrimaryButton({ styles, label, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ styles, label, onPress, compact }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.secondaryButton, compact && styles.compactButton]}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function CardButton({ styles, card, selected, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.card, selected && styles.cardSelected]}>
      <Text style={styles.cardRank}>{card.rank}</Text>
      <Text style={styles.cardSuit}>{card.suit[0].toUpperCase()}</Text>
    </Pressable>
  );
}

function Pile({ styles, label, count, top, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.pile, disabled && styles.disabled]}>
      <Text style={styles.pileLabel}>{label}</Text>
      <Text style={styles.pileTop}>{top ? cardLabel(top) : count}</Text>
    </Pressable>
  );
}

function SettingRow({ styles, label, value, onValueChange }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.resultName}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function Stat({ styles, label, value }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

function ResultBanner({ styles, type, declarer }) {
  const copy = {
    success: "Successful Declare",
    failed: "Failed Declare",
    tie: "Tie Declare",
    "same-card-bonus": "Same Card Bonus"
  }[type];
  return (
    <View style={styles.statusBand}>
      <Text style={styles.statusTitle}>{copy}</Text>
      <Text style={styles.statusText}>{declarer}</Text>
    </View>
  );
}

function playerName(match, id) {
  return match.players.find((player) => player.id === id)?.name || id;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}

function makeTheme(dark) {
  return dark
    ? {
        bg: "#0f172a",
        panel: "#182235",
        raised: "#22314a",
        text: "#f8fafc",
        muted: "#a8b3c7",
        accent: "#2dd4bf",
        accentText: "#05231f",
        border: "#334155",
        danger: "#fb7185"
      }
    : {
        bg: "#f7f7f2",
        panel: "#ffffff",
        raised: "#e8efe9",
        text: "#17201c",
        muted: "#5f6f67",
        accent: "#0f9f82",
        accentText: "#ffffff",
        border: "#cbd5cf",
        danger: "#be123c"
      };
}

function createStyles(theme, largeCards) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.bg },
    screen: { flex: 1, backgroundColor: theme.bg },
    screenContent: { padding: 20, gap: 14, paddingBottom: 40 },
    hero: { minHeight: 170, justifyContent: "flex-end", paddingVertical: 20 },
    kicker: { color: theme.accent, fontSize: 16, fontWeight: "800", letterSpacing: 0 },
    title: { color: theme.text, fontSize: 42, lineHeight: 48, fontWeight: "900", letterSpacing: 0 },
    heading: { color: theme.text, fontSize: 22, fontWeight: "800", letterSpacing: 0 },
    label: { color: theme.muted, fontSize: 14, fontWeight: "700", marginTop: 8 },
    muted: { color: theme.muted, fontSize: 14, letterSpacing: 0 },
    placeholder: { color: theme.muted },
    button: { minHeight: 52, borderRadius: 8, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    buttonText: { color: theme.accentText, fontWeight: "900", fontSize: 16, letterSpacing: 0 },
    secondaryButton: { minHeight: 48, flex: 1, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
    compactButton: { minHeight: 40, flex: 0, minWidth: 78 },
    secondaryText: { color: theme.text, fontWeight: "800", letterSpacing: 0 },
    disabled: { opacity: 0.45 },
    row: { flexDirection: "row", gap: 10, alignItems: "center" },
    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    topSpacer: { width: 78 },
    segmentRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    segment: { width: 48, height: 42, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border },
    smallSegment: { flex: 1, height: 40, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border },
    tinySegment: { flex: 1, height: 36, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border },
    segmentActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    segmentText: { color: theme.text, fontWeight: "800", letterSpacing: 0 },
    playerEditor: { gap: 8, padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    input: { minHeight: 44, borderRadius: 8, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, color: theme.text, paddingHorizontal: 12, fontWeight: "700" },
    statusBand: { gap: 6, padding: 14, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    statusTitle: { color: theme.text, fontSize: 20, fontWeight: "900", letterSpacing: 0 },
    statusText: { color: theme.muted, fontSize: 15, fontWeight: "700", letterSpacing: 0 },
    piles: { flexDirection: "row", gap: 12 },
    pile: { flex: 1, minHeight: 112, borderRadius: 8, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", gap: 8 },
    pileLabel: { color: theme.muted, fontWeight: "800" },
    pileTop: { color: theme.text, fontSize: 28, fontWeight: "900", letterSpacing: 0 },
    handGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    card: { width: largeCards ? 72 : 58, height: largeCards ? 102 : 84, borderRadius: 8, backgroundColor: theme.panel, borderWidth: 2, borderColor: theme.border, padding: 8, justifyContent: "space-between" },
    cardSelected: { borderColor: theme.accent, transform: [{ translateY: -6 }], backgroundColor: theme.raised },
    cardRank: { color: theme.text, fontSize: largeCards ? 24 : 20, fontWeight: "900", letterSpacing: 0 },
    cardSuit: { color: theme.danger, fontSize: 16, fontWeight: "900", alignSelf: "flex-end", letterSpacing: 0 },
    actionBar: { gap: 10, marginTop: 8 },
    scoreboardPanel: { gap: 8, padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    scorecardRow: { minHeight: 34, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.border },
    resultRow: { gap: 6, padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    resultHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
    resultName: { color: theme.text, fontSize: 16, fontWeight: "800", letterSpacing: 0 },
    resultScore: { color: theme.accent, fontSize: 16, fontWeight: "900", letterSpacing: 0 },
    leaderRow: { minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderRadius: 8, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border },
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    statBox: { width: "47%", minHeight: 88, borderRadius: 8, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
    statValue: { color: theme.text, fontSize: 28, fontWeight: "900", letterSpacing: 0 },
    settingRow: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    modalShade: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
    modalPanel: { width: "100%", maxWidth: 420, gap: 12, borderRadius: 8, padding: 16, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }
  });
}
