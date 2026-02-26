import { registerVk, generateProof, verifyProof } from "./prove";
import { CircuitKind } from "./type";
import {
  Field,
  shuffle_deck,
  deal_cards,
  card_to_string,
} from "./circuits/index";
import path from "path";
import fs from "fs";

async function main() {
  const time_A: number = Date.now();
  const seed_A: string = time_A.toString();

  try {
    console.log(` ## Registering Verification Keys`);
    const vk_A = await registerVk(CircuitKind.SHUFFLE);
    const vk_B = await registerVk(CircuitKind.DEAL);

    console.log(`=>seed_A: ${seed_A}`);

    console.log(` ## Shuffling cards`);
    const shuffled_deck_A: Field[] = await shuffle_deck(seed_A);

    console.log(` ## Generating Proofs`);
    await generateProof(CircuitKind.SHUFFLE, {
      seed: seed_A,
      shuffled_deck: shuffled_deck_A,
    });

    const SHUFFLE_PROOF_PATH = path.join(
      __dirname,
      "circuits",
      "target",
      `${CircuitKind.SHUFFLE}_proof.hex`,
    );
    if (!fs.existsSync(SHUFFLE_PROOF_PATH)) {
      throw new Error("[ERR: Shuffle] Shuffle proof not found");
    }
    const shuffle_proofHex = fs.readFileSync(SHUFFLE_PROOF_PATH, "utf-8");

    const SHUFFLE_PUB_INPUTS_PATH = path.join(
      __dirname,
      "circuits",
      "target",
      `${CircuitKind.SHUFFLE}_publicInputs.json`,
    );
    if (!fs.existsSync(SHUFFLE_PUB_INPUTS_PATH)) {
      throw new Error("[ERR: Shuffle] Shuffle public inputs not found");
    }
    const shuffle_pubInputsJson = fs.readFileSync(
      SHUFFLE_PUB_INPUTS_PATH,
      "utf-8",
    );
    const shuffle_pubInputs = JSON.parse(shuffle_pubInputsJson) as string[];
    const shuffle_formattedPublicInputs = shuffle_pubInputs.map((pi) =>
      pi.startsWith("0x") ? pi : `0x${pi}`,
    );

    await verifyProof(
      CircuitKind.SHUFFLE,
      shuffle_proofHex,
      shuffle_formattedPublicInputs,
    );

    console.log("\n ==> SHUFFLE SETTLED");

    console.log("## Dealing hands");
    const [dealt_cards_A, dealt_commitment_A] = await deal_cards(
      shuffled_deck_A,
      seed_A,
    );

    console.log(` ## Generating Proofs`);
    await generateProof(CircuitKind.DEAL, {
      seed: seed_A,
      commitment: dealt_commitment_A,
      cards: dealt_cards_A,
    });

    const DEAL_PROOF_PATH = path.join(
      __dirname,
      "circuits",
      "target",
      `${CircuitKind.DEAL}_proof.hex`,
    );
    if (!fs.existsSync(DEAL_PROOF_PATH)) {
      throw new Error("[ERR: Deal] Deal proof not found");
    }
    const deal_proofHex = fs.readFileSync(DEAL_PROOF_PATH, "utf-8");

    const DEAL_PUB_INPUTS_PATH = path.join(
      __dirname,
      "circuits",
      "target",
      `${CircuitKind.DEAL}_publicInputs.json`,
    );
    if (!fs.existsSync(DEAL_PUB_INPUTS_PATH)) {
      throw new Error("[ERR: Deal] Deal public inputs not found");
    }
    const deal_pubInputsJson = fs.readFileSync(DEAL_PUB_INPUTS_PATH, "utf-8");
    const deal_pubInputs = JSON.parse(deal_pubInputsJson) as string[];
    const deal_formattedPublicInputs = deal_pubInputs.map((pi) =>
      pi.startsWith("0x") ? pi : `0x${pi}`,
    );

    await verifyProof(
      CircuitKind.DEAL,
      deal_proofHex,
      deal_formattedPublicInputs,
    );

    console.log("\n ==> DEAL SETTLED");
  } catch (error) {
    console.log(error);
  }
}

main();
