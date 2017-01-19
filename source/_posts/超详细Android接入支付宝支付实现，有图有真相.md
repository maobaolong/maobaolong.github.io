---
title: 超详细Android接入支付宝支付实现，有图有真相
date: 2016-4-15 15:25:44
categories: Android
tags: 
    - Android
    - 支付宝
---
接上篇android接入微信支付文章，这篇我们带你来接入支付宝支付服务

## 简介

首先要说明的是个人感觉接入支付宝比微信简单多了， 很轻松的，所以同学们不要紧张~

当然还是老规矩啦，上来肯定的贴上[官网地址](https://open.alipay.com/platform/home.htm)，因为我这些服务天天在更新，而我的文章是教大家方法，而让你不是照葫芦画瓢

![](http://7qnc6h.com1.z0.glb.clouddn.com/z3v2xmf609bb7uz3ahrqapn1at.png)

进入app支付文档有两种方式，一种是直接在下面的开放业务里

![](http://7qnc6h.com1.z0.glb.clouddn.com/8d2da6v7k5jexlogd56guys0pb.png)

还有一种是通过上面的导航栏文档中心，然后滚动到业务接入那一栏，可以看到移动支付

![](http://7qnc6h.com1.z0.glb.clouddn.com/ik5eh33m0cfsk8ewvobw6f2w6d.png)

当然也可以直接打开[这个地址](https://doc.open.alipay.com/doc2/detail?treeId=59&articleId=103563&docType=1)，文档还是挺多，可以关注我勾选的这几项

![](http://7qnc6h.com1.z0.glb.clouddn.com/3cnp7jlj7aqhnjooroddcksvh1.png)

首先这里我也要说明的是个人是不能申请的，只能是企业，所以我demo里面的用的一些资料也是demo里面的

这里是交互流程的[官方文档](https://doc.open.alipay.com/doc2/detail.htm?spm=a219a.7629140.0.0.RJnoXD&treeId=59&articleId=103658&docType=1)，需要详细的可以点进去看看

## 运行Demo

我们来到[官方demo的下载地址](https://doc.open.alipay.com/doc2/detail.htm?treeId=54&articleId=104509&docType=1)

![](http://7qnc6h.com1.z0.glb.clouddn.com/2xhoxosvl56zuma8t8prs8yw4s.png)

可以看到有两个，选择你需要的就行了，下载解压完直接导入eclipse并配置一些参数运行就可以查看效果了

## 导入jar

将demo里面的alipaySdk-20160223.jar拷贝到我们工程的libs下，并添加到依赖中

## 配置

权限

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

activity

```xml
<activity
    android:name="com.alipay.sdk.app.H5PayActivity"
    android:configChanges="orientation|keyboardHidden|navigation"
    android:exported="false"
    android:screenOrientation="behind">
</activity>
<activity
    android:name="com.alipay.sdk.auth.AuthActivity"
    android:configChanges="orientation|keyboardHidden|navigation"
    android:exported="false"
    android:screenOrientation="behind">
</activity>
```

## 订单数据生成

这一步，可以在服务端完成，也可以在本地完成

```java
String orderInfo = getOrderInfo("测试的商品", "该测试商品的详细描述", "0.01");

/**
 * 特别注意，这里的签名逻辑需要放在服务端，切勿将私钥泄露在代码中！
 */
String sign = sign(orderInfo);
try {
    /**
     * 仅需对sign 做URL编码
     */
    sign = URLEncoder.encode(sign, "UTF-8");
} catch (UnsupportedEncodingException e) {
    e.printStackTrace();
}

/**
 * 完整的符合支付宝参数规范的订单信息
 */
final String payInfo = orderInfo + "&sign=\"" + sign + "\"&" + getSignType();

Runnable payRunnable = new Runnable() {

    @Override
    public void run() {
        // 构造PayTask 对象
        PayTask alipay = new PayTask(MainActivity.this);
        // 调用支付接口，获取支付结果
        String result = alipay.pay(payInfo, true);

        Message msg = new Message();
        msg.what = SDK_PAY_FLAG;
        msg.obj = result;
        mHandler.sendMessage(msg);
    }
};

// 必须异步调用
Thread payThread = new Thread(payRunnable);
payThread.start();
```

处理支付结果
```java
@SuppressLint("HandlerLeak")
private Handler mHandler = new Handler() {
    @SuppressWarnings("unused")
    public void handleMessage(Message msg) {
        switch (msg.what) {
            case SDK_PAY_FLAG: {
                PayResult payResult = new PayResult((String) msg.obj);
                /**
                 * 同步返回的结果必须放置到服务端进行验证（验证的规则请看https://doc.open.alipay.com/doc2/
                 * detail.htm?spm=0.0.0.0.xdvAU6&treeId=59&articleId=103665&
                 * docType=1) 建议商户依赖异步通知
                 */
                String resultInfo = payResult.getResult();// 同步返回需要验证的信息

                String resultStatus = payResult.getResultStatus();
                // 判断resultStatus 为“9000”则代表支付成功，具体状态码代表含义可参考接口文档
                if (TextUtils.equals(resultStatus, "9000")) {
                    Toast.makeText(MainActivity.this, "支付成功", Toast.LENGTH_SHORT).show();
                } else {
                    // 判断resultStatus 为非"9000"则代表可能支付失败
                    // "8000"代表支付结果因为支付渠道原因或者系统原因还在等待支付结果确认，最终交易是否成功以服务端异步通知为准（小概率状态）
                    if (TextUtils.equals(resultStatus, "8000")) {
                        Toast.makeText(MainActivity.this, "支付结果确认中", Toast.LENGTH_SHORT).show();

                    } else {
                        // 其他值就可以判断为支付失败，包括用户主动取消支付，或者系统返回的错误
                        Toast.makeText(MainActivity.this, "支付失败", Toast.LENGTH_SHORT).show();

                    }
                }
                break;
            }
            default:
                break;
        }
    }

};
```

这里支付成功了，只是提示用户，还得从服务器确认是否正在支付了，我这里只写了本地，其他如果在服务端实现是一样的，你把这代码直接发给后端就行了（如果后端是Java开发），可以看到我们已经成功调起支付宝服务了

![](http://7qnc6h.com1.z0.glb.clouddn.com/ngr5nvgrazguvark7ul5m6vjqn.png)

完整代码：

```java
package cn.woblog.testalipay;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.support.v7.app.AppCompatActivity;
import android.text.TextUtils;
import android.view.View;
import android.widget.Toast;

import com.alipay.sdk.app.PayTask;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Random;

import cn.woblog.testalipay.domain.PayResult;
import cn.woblog.testalipay.util.SignUtils;

public class MainActivity extends AppCompatActivity {
    public static final String PARTNER = "";

    // 商户收款账号
    public static final String SELLER = "";

    // 商户私钥，pkcs8格式
    public static final String RSA_PRIVATE = "";

    private static final int SDK_PAY_FLAG = 1;

    @SuppressLint("HandlerLeak")
    private Handler mHandler = new Handler() {
        @SuppressWarnings("unused")
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case SDK_PAY_FLAG: {
                    PayResult payResult = new PayResult((String) msg.obj);
                    /**
                     * 同步返回的结果必须放置到服务端进行验证（验证的规则请看https://doc.open.alipay.com/doc2/
                     * detail.htm?spm=0.0.0.0.xdvAU6&treeId=59&articleId=103665&
                     * docType=1) 建议商户依赖异步通知
                     */
                    String resultInfo = payResult.getResult();// 同步返回需要验证的信息

                    String resultStatus = payResult.getResultStatus();
                    // 判断resultStatus 为“9000”则代表支付成功，具体状态码代表含义可参考接口文档
                    if (TextUtils.equals(resultStatus, "9000")) {
                        Toast.makeText(MainActivity.this, "支付成功", Toast.LENGTH_SHORT).show();
                    } else {
                        // 判断resultStatus 为非"9000"则代表可能支付失败
                        // "8000"代表支付结果因为支付渠道原因或者系统原因还在等待支付结果确认，最终交易是否成功以服务端异步通知为准（小概率状态）
                        if (TextUtils.equals(resultStatus, "8000")) {
                            Toast.makeText(MainActivity.this, "支付结果确认中", Toast.LENGTH_SHORT).show();

                        } else {
                            // 其他值就可以判断为支付失败，包括用户主动取消支付，或者系统返回的错误
                            Toast.makeText(MainActivity.this, "支付失败", Toast.LENGTH_SHORT).show();

                        }
                    }
                    break;
                }
                default:
                    break;
            }
        }

    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
    }

    public void testAlipay(View view) {
        if (TextUtils.isEmpty(PARTNER) || TextUtils.isEmpty(RSA_PRIVATE) || TextUtils.isEmpty(SELLER)) {
            new AlertDialog.Builder(this).setTitle("警告").setMessage("需要配置PARTNER | RSA_PRIVATE| SELLER")
                    .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface dialoginterface, int i) {
                            //
                            finish();
                        }
                    }).show();
            return;
        }

        String orderInfo = getOrderInfo("测试的商品", "该测试商品的详细描述", "0.01");

/**
 * 特别注意，这里的签名逻辑需要放在服务端，切勿将私钥泄露在代码中！
 */
        String sign = sign(orderInfo);
        try {
            /**
             * 仅需对sign 做URL编码
             */
            sign = URLEncoder.encode(sign, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            e.printStackTrace();
        }

/**
 * 完整的符合支付宝参数规范的订单信息
 */
        final String payInfo = orderInfo + "&sign=\"" + sign + "\"&" + getSignType();

        Runnable payRunnable = new Runnable() {

            @Override
            public void run() {
                // 构造PayTask 对象
                PayTask alipay = new PayTask(MainActivity.this);
                // 调用支付接口，获取支付结果
                String result = alipay.pay(payInfo, true);

                Message msg = new Message();
                msg.what = SDK_PAY_FLAG;
                msg.obj = result;
                mHandler.sendMessage(msg);
            }
        };

// 必须异步调用
        Thread payThread = new Thread(payRunnable);
        payThread.start();
    }


    /**
     * create the order info. 创建订单信息
     */
    private String getOrderInfo(String subject, String body, String price) {

        // 签约合作者身份ID
        String orderInfo = "partner=" + "\"" + PARTNER + "\"";

        // 签约卖家支付宝账号
        orderInfo += "&seller_id=" + "\"" + SELLER + "\"";

        // 商户网站唯一订单号
        orderInfo += "&out_trade_no=" + "\"" + getOutTradeNo() + "\"";

        // 商品名称
        orderInfo += "&subject=" + "\"" + subject + "\"";

        // 商品详情
        orderInfo += "&body=" + "\"" + body + "\"";

        // 商品金额
        orderInfo += "&total_fee=" + "\"" + price + "\"";

        // 服务器异步通知页面路径
        orderInfo += "&notify_url=" + "\"" + "http://notify.msp.hk/notify.htm" + "\"";

        // 服务接口名称， 固定值
        orderInfo += "&service=\"mobile.securitypay.pay\"";

        // 支付类型， 固定值
        orderInfo += "&payment_type=\"1\"";

        // 参数编码， 固定值
        orderInfo += "&_input_charset=\"utf-8\"";

        // 设置未付款交易的超时时间
        // 默认30分钟，一旦超时，该笔交易就会自动被关闭。
        // 取值范围：1m～15d。
        // m-分钟，h-小时，d-天，1c-当天（无论交易何时创建，都在0点关闭）。
        // 该参数数值不接受小数点，如1.5h，可转换为90m。
        orderInfo += "&it_b_pay=\"30m\"";

        // extern_token为经过快登授权获取到的alipay_open_id,带上此参数用户将使用授权的账户进行支付
        // orderInfo += "&extern_token=" + "\"" + extern_token + "\"";

        // 支付宝处理完请求后，当前页面跳转到商户指定页面的路径，可空
        orderInfo += "&return_url=\"m.alipay.com\"";

        // 调用银行卡支付，需配置此参数，参与签名， 固定值 （需要签约《无线银行卡快捷支付》才能使用）
        // orderInfo += "&paymethod=\"expressGateway\"";

        return orderInfo;
    }

    /**
     * sign the order info. 对订单信息进行签名
     *
     * @param content 待签名订单信息
     */
    private String sign(String content) {
        return SignUtils.sign(content, RSA_PRIVATE);
    }

    /**
     * get the sign type we use. 获取签名方式
     */
    private String getSignType() {
        return "sign_type=\"RSA\"";
    }

    /**
     * get the out_trade_no for an order. 生成商户订单号，该值在商户端应保持唯一（可自定义格式规范）
     */
    private String getOutTradeNo() {
        SimpleDateFormat format = new SimpleDateFormat("MMddHHmmss", Locale.getDefault());
        Date date = new Date();
        String key = format.format(date);

        Random r = new Random();
        key = key + r.nextInt();
        key = key.substring(0, 15);
        return key;
    }

}
```

如果要测试demo，请替换

MainActivity中PARTNER，SELLER，RSA_PRIVATE为你申请到的值

以上测试代码都在[github上](https://github.com/lifengsofts/TestAlipay)，官方的下载的sdk包也在该仓库的docs目录下

如果我的文章对来带来的帮助，可加我微信，微博，QQ什么啥的交个朋友也是不错的，另外微信，微博都会不定期发一些优质的文章，感谢大家的支持
~，联系方式在我的个人介绍里啦