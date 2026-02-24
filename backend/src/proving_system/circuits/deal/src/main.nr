use assist::{CARDS_PER_PLAYER, deal_cards, shuffle_deck};

fn main(seed: Field, commitment: Field, cards: [Field; CARDS_PER_PLAYER]) {
    let deck = shuffle_deck(seed);
    let mut acc = 0;
    for i in 0..cards.len() {
        acc += cards[i] - deck[i];
    }
    assert(acc == 0, "[ERR: Deck]: Invalid deal!");

    let (_dealt_cards, dealt_commitment) = deal_cards(deck, seed);
    assert(dealt_commitment == commitment, "[ERR: Deck]: Invalid deal commitment!");
}
