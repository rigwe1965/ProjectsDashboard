# Licences for the products sold one copy per customer

Design and reasons: `docs/PLAN-licensing.md`. This folder is steps 1 and 2 of its build order: the licence format and check, and the tool you use to issue licences. No product uses it yet.

## What a licence is

One line of text, for example `FKL1.eyJ2IjoxLC...abc.Zm9v...xyz`:

- `FKL1` is the format version.
- The middle part is a small JSON document: licence id, product (`rmm`, `reci`), customer name, tier, limits (for example `{"devices": 250, "users": 25}`, `null` meaning unlimited), start and end dates.
- The last part is an Ed25519 signature over the first two parts, made with **your private key**.

A product holds the matching **public key** and checks the signature by itself, with no internet. Changing any character (a higher limit, a later end date) makes the check fail.

## Your signing key

```
node licensing/cli.mjs keygen
```

- Saved at `~/.facyke-licence/signing-key.pem`. The tool refuses to put it inside this repository and refuses to overwrite an existing key.
- **Back it up somewhere private** (not a repository, not a server a customer controls). If it is lost, no new licence can be issued that the products already out there accept.
- It prints the **public key**. That is the only thing built into a product.
- A product may carry two public keys, so a key can be replaced later without breaking licences already out.

## Issuing a licence

```
node licensing/cli.mjs issue --product rmm --customer "Acme IT" --tier premium \
     --limit devices=250 --limit users=25 --until 2027-11-30
```

Prints the licence text to send the customer; the customer puts it where the product expects it. The licence is noted (without any secret) in `issued.jsonl` next to your key, so you can see what you have issued. Look at one with `inspect`:

```
node licensing/cli.mjs inspect <text or file> --public-key <key> --use devices=262
```

Renewal is just issuing a new licence. Revoking early is not part of version one: a licence ends on its date.

## What a product does with it

`evaluate(licence, now, usage)` gives a state and what may be added. It never switches anything off.

| State | When | May add more? | Banner |
|---|---|---|---|
| active | more than 30 days before the end | while under each limit | none (a note only if over a limit) |
| expiring | within 30 days of the end | while under each limit | "ends on …, renew to keep adding more" |
| grace | up to 30 days after the end | while under each limit | "ended on …, you can keep adding until …" |
| lapsed | more than 30 days after the end | no | "ended on …; everything you have keeps working, but you cannot add more" |

A product that is over a limit, or lapsed, only refuses to **add** a device, user or vehicle and says why. Everything that already exists keeps working, and no data is ever locked.

Products also keep an enforcement switch (off until a deployment is sold) so that nothing changes for a running system by accident.

## Two implementations, one set of answers

`licence.mjs` is the reference (Node: RECI and the CRM can use it directly). RMM is Python and needs its own port. `test-vectors.json` is the contract between them: genuine and tampered licences, and what `evaluate` must say at given dates and usages. Each implementation's tests replay it. The vectors use a published **test key**, never a real one. Regenerate with `node licensing/make-test-vectors.mjs`.

## Not here yet

- The RMM port and its device and user counting (step 3).
- RECI white-label and vehicle counting (step 4).
- A licence agreement for customers (step 6; needs a lawyer).
