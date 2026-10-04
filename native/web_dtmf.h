#pragma once
#include "modem.h"
#include "dtmf.h"

// Dedicated receiver around fldigi's optional DTMF decoder. No other modem
// exists while this receiver is active; the original tone code uses 8 kHz PCM.
class WebDtmf final : public modem {
    cDTMF tones;
public:
    WebDtmf() { samplerate = 8000; bandwidth = 0; cap = CAP_RX; }
    void init() override { modem::init(); set_scope_mode(Digiscope::BLANK); }
    void rx_init() override {}
    void tx_init() override {}
    void restart() override {}
    void set_freq(double) override {} // DTMF frequencies are absolute audio Hz.
    int rx_process(const double* samples, int length) override {
        std::vector<float> pcm(samples, samples + length);
        tones.receive(pcm.data(), pcm.size());
        return 0;
    }
    void rx_flush() override { tones.flush(); }
};
