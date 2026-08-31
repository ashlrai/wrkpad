# Ownership and recovery

The occupancy state is wrkpad policy, not firmware state.

| Mode | Device activity | Entry requirement |
| --- | --- | --- |
| `observe` | Enumerate operating-system and process facts only | Default |
| `shadow` | Bounded correlated reads; no lighting | Present recognized device and descriptor evidence |
| `takeover` | One wrkpad writer may paint supported lighting only | Exact compatibility tuple, active OAI layer, no likely external writer, local lease, explicit confirmation |
| `release` | Stop writes, close handle, invalidate lease | Existing takeover |

Current source can persist and test the state machine. The desk descriptor is now captured read-only, but runtime evidence still blocks shadow and takeover: the live Input connection reports firmware `v0.1.50`, the required status/RGB methods return `Method not found`, potential external HID clients remain open and exclusive ownership is unproven, and no write transport is enabled in wrkpad.

## Why process checks are insufficient

On macOS, multiple clients may open the vendor collection non-exclusively. They can receive one another's replies and overwrite lighting. Quitting ChatGPT and Input is a takeover prerequisite, not proof of exclusivity.

wrkpad must eventually combine:

- a local process-identity lease and operating-system lock;
- likely-writer process probes;
- exact response-ID correlation;
- ongoing health and foreign-reply detection;
- bounded cleanup on signals and disconnect.

## Crash behavior

Closing a HID handle does not prove the LEDs returned to their previous vendor state. A crash may leave the last frame visible. Do not promise automatic restoration until a supported device can read back the state it needs to restore.

A future `release --clear` is itself a lighting mutation. It requires a supported tuple and explicit operator action. Recovery ends only after the native owner restarts and its expected lighting is visibly confirmed.

## Commands

```bash
wrkpad occupancy status
wrkpad occupancy observe
wrkpad occupancy shadow
wrkpad occupancy takeover --confirm-exclusive
wrkpad occupancy release
```

Blocked transitions exit nonzero and leave the persisted mode unchanged.
