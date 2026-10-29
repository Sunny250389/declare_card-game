import { PrimaryButton, Screen, Segment, TopBar } from "../components/ui.jsx";
import { capitalize } from "../format.js";

export function SetupScreen({ setup, setSetup, onBack, onStart }) {
  const indexes = Array.from({ length: setup.numberOfPlayers }, (_, index) => index);

  function update(field, index, value) {
    const values = [...setup[field]];
    values[index] = value;
    setSetup({ ...setup, [field]: values });
  }

  return (
    <Screen>
      <TopBar title="Setup" onBack={onBack} />
      <p className="label">Players</p>
      <div className="segment-row">
        {[2, 3, 4, 5, 6].map((count) => (
          <Segment key={count} label={String(count)} active={setup.numberOfPlayers === count} onClick={() => setSetup({ ...setup, numberOfPlayers: count })} />
        ))}
      </div>
      {indexes.map((index) => (
        <div key={index} className="panel">
          <input
            className="input"
            value={setup.playerNames[index]}
            placeholder={`Player ${index + 1}`}
            onChange={(event) => update("playerNames", index, event.target.value)}
          />
          <div className="row">
            {["human", "ai"].map((type) => (
              <Segment
                key={type}
                className="small-segment"
                label={type === "human" ? "Human" : "AI"}
                active={setup.playerTypes[index] === type}
                onClick={() => update("playerTypes", index, type)}
              />
            ))}
          </div>
          {setup.playerTypes[index] === "ai" && (
            <div className="row">
              {["easy", "medium", "hard"].map((difficulty) => (
                <Segment
                  key={difficulty}
                  className="tiny-segment"
                  label={capitalize(difficulty)}
                  active={setup.difficulties[index] === difficulty}
                  onClick={() => update("difficulties", index, difficulty)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <PrimaryButton label="Start Match" onClick={onStart} />
    </Screen>
  );
}
