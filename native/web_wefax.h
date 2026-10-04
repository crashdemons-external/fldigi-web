#pragma once
struct LPM_VALUES {int m_value;const char* m_label;};
inline LPM_VALUES all_lpm_values[4]={{240,"240"},{120,"120"},{90,"90"},{60,"60"}};
inline void activate_wefax_image_item(bool){}
namespace wefax_pic {
inline int width=1809;
inline void resize_rx_viewer(int w){width=w;web_image_start(w,512);}
inline void update_rx_pic_bw(int value,int pixel){web_image_gray(value,pixel,width);}
inline void save_image(const std::string&,const std::string&){}
inline void setwefax_map_link(wefax*){} inline void create_both(bool){}
inline void restart_tx_viewer(){} inline void set_manual(bool){}
}
