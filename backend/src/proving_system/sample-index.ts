import { registerVk, generateProof, verifyProof } from "./prove";
import { CircuitKind } from "./type";
import {
  Field,
  shuffle_deck,
  deal_cards,
  card_to_string,
} from "./circuits/index";

async function main() {
  const time_A: number = Date.now();
  const seed_A: string = time_A.toString();

  try {
    console.log(` ## Registering Verification Keys`);
    await registerVk(CircuitKind.SHUFFLE);
    await registerVk(CircuitKind.DEAL);

    console.log(`=>seed_A: ${seed_A}`);

    console.log(` ## Shuffling cards`);
    const shuffled_deck_A: Field[] = await shuffle_deck(seed_A);

    console.log(` ## Generating Proofs`);
    const shuffleProof = await generateProof(CircuitKind.SHUFFLE, {
      seed: seed_A,
      shuffled_deck: shuffled_deck_A,
    });

    await verifyProof(
      CircuitKind.SHUFFLE,
      shuffleProof.proofHex,
      shuffleProof.publicInputs,
    );

    console.log("\n ==> SHUFFLE SETTLED");

    console.log("## Dealing hands");
    const [dealt_cards_A, dealt_commitment_A] = await deal_cards(
      shuffled_deck_A,
      seed_A,
    );

    console.log(` ## Generating Proofs`);
    const dealProof = await generateProof(CircuitKind.DEAL, {
      seed: seed_A,
      commitment: dealt_commitment_A,
      cards: dealt_cards_A,
    });

    await verifyProof(
      CircuitKind.DEAL,
      dealProof.proofHex,
      dealProof.publicInputs,
    );

    console.log("\n ==> DEAL SETTLED");
  } catch (error) {
    console.log(error);
  }
}

main();
