use dep::std;

global STANDARD_DECK_SIZE: u32 = 52;
global NUM_PLAYERS: u32 = 2;
global CARDS_PER_PLAYER: u32 = 5;
global GAMMA: Field = 12345;

#[export]
pub fn shuffle_deck(seed: Field) -> [Field; STANDARD_DECK_SIZE] {
    // DECK AUTHENTICITY: Initialize deck with sequential values representing playing cards
    let mut deck: [Field; STANDARD_DECK_SIZE] = [0; STANDARD_DECK_SIZE];
    for i in 0..STANDARD_DECK_SIZE {
        deck[i] = i as Field;
    }

    // SHUFFLE ACTION: Perform Fisher-Yates shuffle
    for n in 0..deck.len() {
        let i = deck.len() - 1 - n;
        let rng = std::hash::pedersen_hash([seed, i as Field]);
        let j = rng as u32 % (i + 1);
        let mut selected_value: Field = 0;
        for k in 0..(i + 1) {
            selected_value += deck[k] * ((k == j) as Field);
        }
        for k in 0..(i + 1) {
            deck[k] = deck[k] * (((k != i) & (k != j)) as Field)
                + deck[i] * ((k == j) as Field)
                + selected_value * (((k == i) & (k != j)) as Field);
        }
    }
    deck
}

pub fn constrain_deck_integrity<let N: u32>(original_deck: [Field; N], shuffled_deck: [Field; N]) {
    assert(original_deck.len() == shuffled_deck.len(), "[ERR: Deck]: Deck length mismatch!");
    let gamma = std::hash::pedersen_hash([GAMMA]);
    let mut expected_product: Field = 1;
    let mut actual_product: Field = 1;
    for i in 0..original_deck.len() {
        expected_product *= (gamma + original_deck[i]);
        actual_product *= (gamma + shuffled_deck[i]);
    }
    assert(expected_product == actual_product, "[ERR: Deck]: Deck integrity compromised!");
}
