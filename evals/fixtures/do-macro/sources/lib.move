module example::lib;

public fun sum(xs: vector<u64>): u64 {
    let mut total: u64 = 0;
    let mut i = 0;
    let n = xs.length();
    while (i < n) {
        total = total + xs[i];
        i = i + 1;
    };
    total
}
