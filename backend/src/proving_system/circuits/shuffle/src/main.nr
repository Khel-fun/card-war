use assist::{constrain_deck_integrity, shuffle_deck, STANDARD_DECK_SIZE};

fn main(seed: Field, shuffled_deck: [Field; STANDARD_DECK_SIZE]) {
    let deck = shuffle_deck(seed);
    let mut acc = 0;
    for i in 0..deck.len() {
        acc += shuffled_deck[i] - deck[i];
    }
    assert(acc == 0, "[ERR: Deck]: Invalid shuffle!");

    let mut standard_deck: [Field; STANDARD_DECK_SIZE] = [0; STANDARD_DECK_SIZE];
    for i in 0..STANDARD_DECK_SIZE {
        standard_deck[i] = i as Field;
    }
    constrain_deck_integrity(standard_deck, shuffled_deck);
}
