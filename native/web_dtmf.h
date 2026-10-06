#pragma once
#include "modem.h"
#include "dtmf.h"

// Dedicated modem around fldigi's optional DTMF code. No other modem
// exists while this receiver is active; the original tone code uses 8 kHz PCM.
class WebDtmf final : public modem {
    cDTMF tones;
public:
    int tone_ms = 50, gap_ms = 50;
    WebDtmf() { samplerate = 8000; bandwidth = 0; cap = CAP_RX | CAP_TX; }
    void init() override { modem::init(); set_scope_mode(Digiscope::BLANK); }
    void rx_init() override {}
    void tx_init() override {}
    int tx_process() override {
        int c = get_tx_char();
        if (c == GET_TX_CHAR_ETX || stopflag) { stopflag = false; return -1; }
        if (c == GET_TX_CHAR_NODATA) { tones.silence(50); return 0; }
        // Keep upstream tone shaping and keypad mapping with configured timing.
        progdefaults.DTMFstr.assign(1, static_cast<char>(c));
        tones.send(tone_ms, gap_ms);
        put_echo_char(c);
        return 0;
    }
    void restart() override {}
    void set_freq(double) override {} // DTMF frequencies are absolute audio Hz.
    int rx_process(const double* samples, int length) override {
        std::vector<float> pcm(samples, samples + length);
        tones.receive(pcm.data(), pcm.size());
        return 0;
    }
    void rx_flush() override { tones.flush(); }
};
